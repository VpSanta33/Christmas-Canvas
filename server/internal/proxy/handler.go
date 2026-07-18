package proxy

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"mime"
	"mime/multipart"
	"net/http"
	"net/http/httputil"
	"net/url"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/basketikun/infinite-canvas/server/internal/httpx"
	"github.com/basketikun/infinite-canvas/server/internal/middleware"
)

// Handler 是 AI 反向代理：/api/ai/:channelId/*path → <channel.BaseURL>/*path，
// 服务端注入渠道密钥。前端在 backend 模式下把 baseUrl 设为 /api/ai/:channelId 即可，
// 各请求函数（生图/改图/问答 SSE/视频轮询/TTS）的 body 与路径完全不变。
type Handler struct {
	channels *ChannelStore
	usage    UsageRecorder
	credits  Charger
}

// UsageRecorder 记录一次调用的结果（配额包会实现它）。
type UsageRecorder interface {
	Record(ctx context.Context, ev UsageEvent)
}

// UsageEvent 描述一次 AI 调用的结果，供落库与 admin 排障。
type UsageEvent struct {
	UserID       string
	Capability   string
	ChannelID    string
	Model        string
	Status       string // ok | error | timeout | cancelled | rejected
	HTTPStatus   int
	ErrorMessage string
	RequestID    string
	LatencyMs    int64
	Credits      int64
	Refunded     bool
}

// Charger 负责积分的预检与扣费（credits 包实现）。
type Charger interface {
	Balance(ctx context.Context, userID string) (int64, error)
	Charge(ctx context.Context, userID string, cost int64, capability, channelID, model string) (int64, error)
	Refund(ctx context.Context, userID string, amount int64, capability, channelID, model string) (int64, error)
}

func NewHandler(channels *ChannelStore, usage UsageRecorder, credits Charger) *Handler {
	return &Handler{channels: channels, usage: usage, credits: credits}
}

// Forward 处理所有转发。透明流式（SSE / 大响应）由 httputil.ReverseProxy 保证。
func (h *Handler) Forward(c *gin.Context) {
	startedAt := time.Now()
	requestID := middleware.RequestIDFrom(c)
	uid := middleware.UserIDFrom(c)
	channelID := c.Param("channelId")
	ch, err := h.channels.Get(c.Request.Context(), channelID)
	if err == ErrChannelNotFound {
		httpx.NotFound(c, "channel not found")
		return
	}
	if err != nil {
		httpx.Internal(c, err)
		return
	}
	if !ch.Enabled {
		httpx.Forbidden(c, "channel disabled")
		return
	}

	// /api/ai/:channelId/v1/images/generations → 上游 path 为 /v1/images/generations
	upstreamPath := c.Param("path")

	// 计费：仅对 POST（生成类创建请求）计费；视频轮询/文件下载是 GET，天然不计费。
	// 请求前校验管理员模型白名单并原子扣费，上游失败则退款，避免并发免费调用和失败扣费。
	var cost int64
	var model string
	var requestBody []byte
	capability := capabilityFromPath(upstreamPath)
	proxyChannels := []Channel{ch}
	charged := false
	if c.Request.Method == http.MethodPost {
		if c.Request.Body != nil {
			var readErr error
			requestBody, readErr = io.ReadAll(c.Request.Body)
			_ = c.Request.Body.Close()
			if readErr != nil {
				httpx.Internal(c, readErr)
				return
			}
			c.Request.Body = io.NopCloser(bytes.NewReader(requestBody))
			c.Request.ContentLength = int64(len(requestBody))
		}
		model = extractModel(requestBody, c.GetHeader("Content-Type"), upstreamPath)
		configuredModel, ok := findChannelModel(ch.Models, model)
		if !ok {
			httpx.Forbidden(c, "model not enabled")
			return
		}
		if configuredModel.Capability != "" {
			capability = configuredModel.Capability
		}
		cost = configuredModel.Cost
		if cost < 0 {
			cost = 0
		}
		_, failoverEnabled, fallbackPricing, settingsErr := h.channels.ModelOperations(c.Request.Context())
		if settingsErr != nil {
			httpx.Internal(c, settingsErr)
			return
		}
		if failoverEnabled {
			fallbacks, fallbackErr := h.channels.FallbackChannels(c.Request.Context(), channelID, model, capability, ch.APIFormat)
			if fallbackErr != nil {
				httpx.Internal(c, fallbackErr)
				return
			}
			proxyChannels = append(proxyChannels, fallbacks...)
		}
		cost = generationCost(cost, capability, requestBody, c.GetHeader("Content-Type"), generationPricingForModel(configuredModel, fallbackPricing))
		if h.credits != nil && cost > 0 {
			bal, balErr := h.credits.Balance(c.Request.Context(), uid)
			if balErr != nil {
				httpx.Internal(c, balErr)
				return
			}
			if bal < cost {
				if h.usage != nil {
					h.usage.Record(context.Background(), UsageEvent{
						UserID: uid, Capability: capability, ChannelID: channelID, Model: model,
						Status: "rejected", HTTPStatus: http.StatusPaymentRequired,
						ErrorMessage: "积分不足", RequestID: requestID, LatencyMs: time.Since(startedAt).Milliseconds(),
					})
				}
				httpx.Fail(c, http.StatusPaymentRequired, "积分不足，请充值后再试")
				return
			}
			if _, chargeErr := h.credits.Charge(c.Request.Context(), uid, cost, capability, channelID, model); chargeErr != nil {
				// 并发请求可能在余额预检后抢先扣费；再次读取余额以返回准确错误。
				latest, balanceErr := h.credits.Balance(c.Request.Context(), uid)
				if balanceErr == nil && latest < cost {
					httpx.Fail(c, http.StatusPaymentRequired, "积分不足，请充值后再试")
					return
				}
				httpx.Internal(c, chargeErr)
				return
			}
			charged = true
		}
	}
	attemptState := &failoverAttemptState{SelectedChannelID: channelID}

	refundCharge := func() bool {
		if !charged || h.credits == nil || cost <= 0 {
			return false
		}
		charged = false
		if _, err := h.credits.Refund(context.Background(), uid, cost, capability, channelID, model); err != nil {
			log.Printf("refund credits failed (uid=%s cost=%d): %v", uid, cost, err)
			return false
		}
		return true
	}
	recordFailoverFailures := func() {
		if h.usage == nil {
			return
		}
		for _, failure := range attemptState.Failures {
			h.usage.Record(context.Background(), UsageEvent{
				UserID: uid, Capability: capability, ChannelID: failure.ChannelID, Model: model,
				Status: "error", HTTPStatus: failure.HTTPStatus, ErrorMessage: failure.Message,
				RequestID: requestID, LatencyMs: time.Since(startedAt).Milliseconds(),
			})
		}
	}

	proxy := &httputil.ReverseProxy{
		FlushInterval: 100 * time.Millisecond, // 保证 SSE 逐块下推
		Director:      func(req *http.Request) {},
		Transport:     &failoverTransport{Candidates: proxyChannels, UpstreamPath: upstreamPath, RequestBody: requestBody, State: attemptState},
		// 上游响应到达：按状态码记录用量成败；非 2xx 自动退回预扣积分。
		ModifyResponse: func(resp *http.Response) error {
			ok := resp.StatusCode >= 200 && resp.StatusCode < 300
			usedChannelID := attemptState.SelectedChannelID
			if usedChannelID == "" {
				usedChannelID = channelID
			}
			if len(attemptState.AttemptedChannels) > 1 {
				resp.Header.Set("X-Infinite-Canvas-Failover", "true")
				resp.Header.Set("X-Infinite-Canvas-Attempts", fmt.Sprintf("%d", len(attemptState.AttemptedChannels)))
			}
			recordFailoverFailures()
			refunded := false
			if !ok {
				refunded = refundCharge()
			}
			ev := UsageEvent{
				UserID: uid, Capability: capability, ChannelID: usedChannelID, Model: model,
				Status: "ok", HTTPStatus: resp.StatusCode, RequestID: requestID,
				LatencyMs: time.Since(startedAt).Milliseconds(), Credits: cost, Refunded: refunded,
			}
			if !ok {
				ev.Status = usageStatusForHTTP(resp.StatusCode)
				ev.ErrorMessage = snippetUpstreamError(resp)
			}
			if h.usage != nil {
				h.usage.Record(context.Background(), ev)
			}
			return nil
		},
		// 连接上游失败（无 HTTP 响应）：记为 error，http_status=0。
		ErrorHandler: func(w http.ResponseWriter, r *http.Request, e error) {
			refunded := refundCharge()
			recordFailoverFailures()
			usedChannelID := attemptState.SelectedChannelID
			if usedChannelID == "" {
				usedChannelID = channelID
			}
			if h.usage != nil && len(attemptState.Failures) == 0 {
				h.usage.Record(context.Background(), UsageEvent{
					UserID: uid, Capability: capability, ChannelID: usedChannelID, Model: model,
					Status: usageStatusForError(e), HTTPStatus: 0,
					ErrorMessage: "连接上游失败：" + e.Error(),
					RequestID:    requestID, LatencyMs: time.Since(startedAt).Milliseconds(), Credits: cost, Refunded: refunded,
				})
			}
			w.WriteHeader(http.StatusBadGateway)
			_, _ = w.Write([]byte(`{"error":"upstream request failed"}`))
		},
	}

	proxy.ServeHTTP(c.Writer, c.Request)
}

func usageStatusForHTTP(status int) string {
	if status == http.StatusRequestTimeout || status == http.StatusGatewayTimeout {
		return "timeout"
	}
	return "error"
}

func usageStatusForError(err error) string {
	if errors.Is(err, context.Canceled) {
		return "cancelled"
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return "timeout"
	}
	return "error"
}

// snippetUpstreamError 读取上游错误响应的一小段正文用于排障，并把已读内容回填，
// 保证代理仍能把完整错误体透传给前端。非文本或读取失败时回退到状态文案。
func snippetUpstreamError(resp *http.Response) string {
	if resp.Body == nil {
		return http.StatusText(resp.StatusCode)
	}
	const max = 2000
	buf, _ := io.ReadAll(io.LimitReader(resp.Body, max))
	rest, _ := io.ReadAll(resp.Body)
	_ = resp.Body.Close()
	full := append(buf, rest...)
	resp.Body = io.NopCloser(bytes.NewReader(full))
	resp.ContentLength = int64(len(full))
	resp.Header.Del("Content-Length")
	msg := strings.TrimSpace(string(buf))
	if msg == "" {
		return http.StatusText(resp.StatusCode)
	}
	return msg
}

// extractModel 从 JSON、multipart、表单或 Gemini 路径中读取模型名。
func extractModel(body []byte, contentType, path string) string {
	var payload struct {
		Model string `json:"model"`
	}
	if err := json.Unmarshal(body, &payload); err == nil && strings.TrimSpace(payload.Model) != "" {
		return strings.TrimSpace(payload.Model)
	}

	mediaType, params, _ := mime.ParseMediaType(contentType)
	switch mediaType {
	case "multipart/form-data":
		if boundary := params["boundary"]; boundary != "" {
			reader := multipart.NewReader(bytes.NewReader(body), boundary)
			for {
				part, err := reader.NextPart()
				if err == io.EOF {
					break
				}
				if err != nil {
					break
				}
				if part.FormName() == "model" {
					value, _ := io.ReadAll(io.LimitReader(part, 4096))
					_ = part.Close()
					if model := strings.TrimSpace(string(value)); model != "" {
						return model
					}
				}
				_ = part.Close()
			}
		}
	case "application/x-www-form-urlencoded":
		if values, err := url.ParseQuery(string(body)); err == nil {
			if model := strings.TrimSpace(values.Get("model")); model != "" {
				return model
			}
		}
	}
	return modelFromPath(path)
}

func modelFromPath(path string) string {
	parts := strings.Split(strings.Trim(path, "/"), "/")
	for index, part := range parts {
		if part != "models" || index+1 >= len(parts) {
			continue
		}
		value, err := url.PathUnescape(strings.SplitN(parts[index+1], ":", 2)[0])
		if err == nil {
			return strings.TrimSpace(strings.TrimPrefix(value, "models/"))
		}
	}
	return ""
}

// findChannelModel 强制模型命中管理员配置的白名单，防止伪造模型名绕过积分价格。
func findChannelModel(models []ChannelModel, name string) (ChannelModel, bool) {
	name = strings.TrimSpace(name)
	for _, m := range models {
		if m.IsEnabled() && m.Name == name {
			return m, true
		}
	}
	for _, m := range models {
		if m.IsEnabled() && strings.EqualFold(m.Name, name) {
			return m, true
		}
	}
	return ChannelModel{}, false
}

func singleJoin(a, b string) string {
	a = strings.TrimRight(a, "/")
	if b == "" {
		return a
	}
	if !strings.HasPrefix(b, "/") {
		b = "/" + b
	}
	return a + b
}

func capabilityFromPath(p string) string {
	switch {
	case strings.Contains(p, "images"):
		return "image"
	case strings.Contains(p, "videos"), strings.Contains(p, "contents/generations"):
		return "video"
	case strings.Contains(p, "audio"):
		return "audio"
	default:
		return "text"
	}
}
