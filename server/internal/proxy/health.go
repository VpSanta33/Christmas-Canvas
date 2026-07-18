package proxy

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"time"
)

// HealthResult 是一次渠道探活的结果。OK 为 true 表示上游鉴权通过且可正常响应。
type HealthResult struct {
	OK        bool     `json:"ok"`
	Status    int      `json:"status"`    // 上游 HTTP 状态码，0 表示连接失败
	LatencyMs int64    `json:"latencyMs"` // 探测往返耗时
	Models    []string `json:"models"`    // 从上游 /models 拉到的模型 id（尽力而为，可能为空）
	Message   string   `json:"message"`   // 失败原因或提示
}

// healthClient 是探活专用的 HTTP 客户端，超时较短，避免慢渠道拖住 admin 请求。
var healthClient = &http.Client{Timeout: 12 * time.Second}

// CheckHealth 对渠道做一次探活：请求上游的模型列表端点，用返回状态判断 key 是否可用。
// OpenAI 兼容格式打 GET {baseURL}/models；Gemini 打 GET {baseURL}/models?key=...。
// 拉取成功时顺带解析出模型 id 列表，方便 admin 核对可用模型。
func CheckHealth(ctx context.Context, ch Channel) HealthResult {
	base := strings.TrimRight(ch.BaseURL, "/")
	req, err := buildProbeRequest(ctx, base, ch)
	if err != nil {
		return HealthResult{OK: false, Models: []string{}, Message: "构造探测请求失败：" + err.Error()}
	}

	start := time.Now()
	resp, err := healthClient.Do(req)
	latency := time.Since(start).Milliseconds()
	if err != nil {
		return HealthResult{OK: false, LatencyMs: latency, Models: []string{}, Message: "连接上游失败：" + err.Error()}
	}
	defer func() { _ = resp.Body.Close() }()

	body, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20)) // 上限 1MB，防超大响应
	res := HealthResult{Status: resp.StatusCode, LatencyMs: latency, Models: []string{}}
	if resp.StatusCode >= 200 && resp.StatusCode < 300 {
		res.OK = true
		res.Models = parseModelIDs(body, ch.APIFormat)
		res.Message = "渠道可用"
		return res
	}

	switch resp.StatusCode {
	case http.StatusUnauthorized, http.StatusForbidden:
		res.Message = "鉴权失败：API Key 可能无效或权限不足"
	case http.StatusNotFound:
		res.Message = "上游未找到模型列表端点（Base URL 可能有误），但连接正常"
	case http.StatusTooManyRequests:
		res.Message = "上游限流（429），key 有效但暂时受限"
	default:
		res.Message = "上游返回状态 " + http.StatusText(resp.StatusCode)
	}
	return res
}

// buildProbeRequest 按渠道格式构造模型列表探测请求，并注入密钥。
// Base URL 需与前端真实调用一致地补全版本段（gemini→/v1beta，openai→/v1），
// 否则像 https://santaa.ai 这类未带版本段的地址会探到不存在的 /models 而 404。
func buildProbeRequest(ctx context.Context, base string, ch Channel) (*http.Request, error) {
	if ch.APIFormat == "gemini" {
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, geminiProbeBase(base)+"/models", nil)
		if err != nil {
			return nil, err
		}
		req.Header.Set("x-goog-api-key", ch.APIKey)
		return req, nil
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, openAIProbeBase(base)+"/models", nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+ch.APIKey)
	return req, nil
}

// openAIProbeBase 与前端 buildApiUrl 保持一致：已含版本段则不动，否则补 /v1。
func openAIProbeBase(base string) string {
	lower := strings.ToLower(base)
	if strings.HasSuffix(lower, "/v1") || strings.HasSuffix(lower, "/api/v3") || strings.HasSuffix(lower, "/api/plan/v3") {
		return base
	}
	return base + "/v1"
}

// geminiProbeBase 与前端 geminiBaseUrl 保持一致：已含版本段则不动，否则补 /v1beta。
func geminiProbeBase(base string) string {
	lower := strings.ToLower(base)
	if strings.HasSuffix(lower, "/v1") || strings.HasSuffix(lower, "/v1beta") {
		return base
	}
	return base + "/v1beta"
}

// parseModelIDs 尽力从模型列表响应里解析出模型 id。兼容 OpenAI 的 {data:[{id}]}
// 与 Gemini 的 {models:[{name}]} 两种结构；解析失败返回空数组。
func parseModelIDs(body []byte, format string) []string {
	if format == "gemini" {
		var payload struct {
			Models []struct {
				Name string `json:"name"`
			} `json:"models"`
		}
		if err := json.Unmarshal(body, &payload); err != nil {
			return []string{}
		}
		out := make([]string, 0, len(payload.Models))
		for _, m := range payload.Models {
			out = append(out, strings.TrimPrefix(m.Name, "models/"))
		}
		return capModels(out)
	}
	var payload struct {
		Data []struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	if err := json.Unmarshal(body, &payload); err != nil {
		return []string{}
	}
	out := make([]string, 0, len(payload.Data))
	for _, m := range payload.Data {
		out = append(out, m.ID)
	}
	return capModels(out)
}

// capModels 限制返回的模型条数，避免超长列表塞进响应。
func capModels(models []string) []string {
	const max = 100
	if len(models) > max {
		return models[:max]
	}
	return models
}
