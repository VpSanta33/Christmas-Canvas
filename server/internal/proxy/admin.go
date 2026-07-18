package proxy

import (
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/basketikun/infinite-canvas/server/internal/httpx"
)

// AdminHandler 提供公开只读模型目录与仅管理员可写的渠道管理。
type AdminHandler struct {
	channels *ChannelStore
}

func NewAdminHandler(channels *ChannelStore) *AdminHandler {
	return &AdminHandler{channels: channels}
}

// ListPublic 返回启用渠道的最小模型目录，供访客和普通用户渲染模型下拉。
func (h *AdminHandler) ListPublic(c *gin.Context) {
	list, err := h.channels.ListPublic(c.Request.Context())
	if err != nil {
		httpx.Internal(c, err)
		return
	}
	catalog := make([]PublicModelChannel, 0, len(list))
	for _, channel := range list {
		models := activeChannelModels(channel.Models)
		if len(models) == 0 {
			continue
		}
		catalog = append(catalog, PublicModelChannel{
			ID: channel.ID, Name: channel.Name, APIFormat: channel.APIFormat,
			Models: models, Enabled: channel.Enabled,
		})
	}
	defaults, _, pricing, err := h.channels.ModelOperations(c.Request.Context())
	if err != nil {
		httpx.Internal(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"channels": catalog, "defaults": sanitizeModelDefaults(list, defaults), "generationPricing": pricing})
}

type createChannelReq struct {
	Name         string         `json:"name"`
	BaseURL      string         `json:"baseUrl"`
	APIKey       string         `json:"apiKey"`
	APIFormat    string         `json:"apiFormat"`
	Models       []ChannelModel `json:"models"`
	Enabled      *bool          `json:"enabled"`
	Priority     *int           `json:"priority"`
	KeyExpiresAt string         `json:"keyExpiresAt"`
}

// Create 仅 admin。
func (h *AdminHandler) Create(c *gin.Context) {
	var req createChannelReq
	if err := c.ShouldBindJSON(&req); err != nil || req.Name == "" || req.BaseURL == "" || req.APIKey == "" {
		httpx.BadRequest(c, "name, baseUrl, apiKey required")
		return
	}
	format := req.APIFormat
	if format == "" {
		format = "openai"
	}
	enabled := true
	if req.Enabled != nil {
		enabled = *req.Enabled
	}
	priority := 100
	if req.Priority != nil && *req.Priority >= 0 {
		priority = *req.Priority
	}
	keyExpiresAt, parseErr := parseOptionalTime(req.KeyExpiresAt)
	if parseErr != nil {
		httpx.BadRequest(c, "invalid key expiration time")
		return
	}
	id, err := h.channels.Create(c.Request.Context(), Channel{
		Name:         req.Name,
		BaseURL:      req.BaseURL,
		APIKey:       req.APIKey,
		APIFormat:    format,
		Models:       req.Models,
		Enabled:      enabled,
		Priority:     priority,
		KeyExpiresAt: keyExpiresAt,
	})
	if err != nil {
		httpx.Internal(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"id": id})
}

// ListAll 仅 admin：返回全部渠道（含禁用），用于管理列表。
func (h *AdminHandler) ListAll(c *gin.Context) {
	list, err := h.channels.ListAll(c.Request.Context())
	if err != nil {
		httpx.Internal(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"channels": list})
}

// GetModelDefaults 返回平台默认模型与故障切换设置，仅管理员可访问。
func (h *AdminHandler) GetModelDefaults(c *gin.Context) {
	defaults, failoverEnabled, pricing, err := h.channels.ModelOperations(c.Request.Context())
	if err != nil {
		httpx.Internal(c, err)
		return
	}
	channels, err := h.channels.ListAll(c.Request.Context())
	if err != nil {
		httpx.Internal(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"defaults": sanitizeModelDefaults(channels, defaults), "failoverEnabled": failoverEnabled, "generationPricing": pricing})
}

type updateModelOperationsReq struct {
	ModelDefaults
	FailoverEnabled   *bool             `json:"failoverEnabled"`
	GenerationPricing GenerationPricing `json:"generationPricing"`
}

// UpdateModelDefaults 更新默认模型与自动故障切换；默认模型必须命中同能力的已上架模型。
func (h *AdminHandler) UpdateModelDefaults(c *gin.Context) {
	var req updateModelOperationsReq
	if err := c.ShouldBindJSON(&req); err != nil {
		httpx.BadRequest(c, "invalid model defaults")
		return
	}
	failoverEnabled := true
	if req.FailoverEnabled != nil {
		failoverEnabled = *req.FailoverEnabled
	}
	if err := h.channels.UpdateModelOperations(c.Request.Context(), req.ModelDefaults, failoverEnabled, req.GenerationPricing); errors.Is(err, ErrInvalidModelDefault) {
		httpx.BadRequest(c, "default model must be enabled and match its capability")
		return
	} else if err != nil {
		httpx.Internal(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

type updateModelPricingReq struct {
	Model             string            `json:"model"`
	GenerationPricing GenerationPricing `json:"generationPricing"`
}

// UpdateModelPricing 为指定渠道中的单个图像/视频模型保存独立参数积分表。
func (h *AdminHandler) UpdateModelPricing(c *gin.Context) {
	var req updateModelPricingReq
	if err := c.ShouldBindJSON(&req); err != nil || strings.TrimSpace(req.Model) == "" {
		httpx.BadRequest(c, "model and generationPricing required")
		return
	}
	err := h.channels.UpdateModelPricing(c.Request.Context(), c.Param("id"), strings.TrimSpace(req.Model), req.GenerationPricing)
	switch {
	case errors.Is(err, ErrChannelNotFound):
		httpx.NotFound(c, "channel not found")
	case errors.Is(err, ErrChannelModelNotFound):
		httpx.NotFound(c, "model not found")
	case errors.Is(err, ErrUnsupportedPricing):
		httpx.BadRequest(c, "only image and video models support generation pricing")
	case err != nil:
		httpx.Internal(c, err)
	default:
		c.JSON(http.StatusOK, gin.H{"ok": true})
	}
}

type updateChannelReq struct {
	Name         string         `json:"name"`
	BaseURL      string         `json:"baseUrl"`
	APIKey       string         `json:"apiKey"` // 留空表示保留原密钥
	APIFormat    string         `json:"apiFormat"`
	Models       []ChannelModel `json:"models"`
	Enabled      *bool          `json:"enabled"`
	Priority     *int           `json:"priority"`
	KeyExpiresAt string         `json:"keyExpiresAt"`
}

// Update 仅 admin。apiKey 为空时保留原有密钥。
func (h *AdminHandler) Update(c *gin.Context) {
	id := c.Param("id")
	var req updateChannelReq
	if err := c.ShouldBindJSON(&req); err != nil || req.Name == "" || req.BaseURL == "" {
		httpx.BadRequest(c, "name, baseUrl required")
		return
	}
	format := req.APIFormat
	if format == "" {
		format = "openai"
	}
	enabled := true
	if req.Enabled != nil {
		enabled = *req.Enabled
	}
	priority := 100
	if req.Priority != nil && *req.Priority >= 0 {
		priority = *req.Priority
	}
	keyExpiresAt, parseErr := parseOptionalTime(req.KeyExpiresAt)
	if parseErr != nil {
		httpx.BadRequest(c, "invalid key expiration time")
		return
	}
	err := h.channels.Update(c.Request.Context(), id, ChannelUpdate{
		Name:         req.Name,
		BaseURL:      req.BaseURL,
		APIKey:       req.APIKey,
		APIFormat:    format,
		Models:       req.Models,
		Enabled:      enabled,
		Priority:     priority,
		KeyExpiresAt: keyExpiresAt,
	})
	if errors.Is(err, ErrChannelNotFound) {
		httpx.NotFound(c, "channel not found")
		return
	}
	if err != nil {
		httpx.Internal(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func parseOptionalTime(value string) (*time.Time, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil, nil
	}
	if parsed, err := time.Parse(time.RFC3339, value); err == nil {
		return &parsed, nil
	}
	parsed, err := time.Parse("2006-01-02", value)
	if err != nil {
		return nil, err
	}
	parsed = parsed.Add(24*time.Hour - time.Nanosecond)
	return &parsed, nil
}

type toggleChannelReq struct {
	Enabled bool `json:"enabled"`
}

// SetEnabled 仅 admin：快速启用/禁用渠道。
func (h *AdminHandler) SetEnabled(c *gin.Context) {
	id := c.Param("id")
	var req toggleChannelReq
	if err := c.ShouldBindJSON(&req); err != nil {
		httpx.BadRequest(c, "enabled required")
		return
	}
	err := h.channels.SetEnabled(c.Request.Context(), id, req.Enabled)
	if errors.Is(err, ErrChannelNotFound) {
		httpx.NotFound(c, "channel not found")
		return
	}
	if err != nil {
		httpx.Internal(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// Delete 仅 admin。
func (h *AdminHandler) Delete(c *gin.Context) {
	id := c.Param("id")
	err := h.channels.Delete(c.Request.Context(), id)
	if errors.Is(err, ErrChannelNotFound) {
		httpx.NotFound(c, "channel not found")
		return
	}
	if err != nil {
		httpx.Internal(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

type testChannelReq struct {
	BaseURL   string `json:"baseUrl"`
	APIKey    string `json:"apiKey"`
	APIFormat string `json:"apiFormat"`
}

// Test 仅 admin：对渠道做一次上游探活。
// 带 :id 时测试已保存的渠道（apiKey 留空则用库里的密钥，方便测已存渠道而无需回填 key）；
// 无 :id 时用请求体里的 baseUrl/apiKey 现场测试，支持"保存前先验证"。
func (h *AdminHandler) Test(c *gin.Context) {
	var req testChannelReq
	_ = c.ShouldBindJSON(&req)

	var ch Channel
	if id := c.Param("id"); id != "" {
		saved, err := h.channels.Get(c.Request.Context(), id)
		if errors.Is(err, ErrChannelNotFound) {
			httpx.NotFound(c, "channel not found")
			return
		}
		if err != nil {
			httpx.Internal(c, err)
			return
		}
		ch = saved
		if req.BaseURL != "" {
			ch.BaseURL = req.BaseURL
		}
		if req.APIKey != "" {
			ch.APIKey = req.APIKey
		}
		if req.APIFormat != "" {
			ch.APIFormat = req.APIFormat
		}
	} else {
		if req.BaseURL == "" || req.APIKey == "" {
			httpx.BadRequest(c, "baseUrl, apiKey required")
			return
		}
		ch = Channel{BaseURL: req.BaseURL, APIKey: req.APIKey, APIFormat: req.APIFormat}
	}
	if ch.APIFormat == "" {
		ch.APIFormat = "openai"
	}

	result := CheckHealth(c.Request.Context(), ch)
	if ch.ID != "" {
		h.channels.UpdateHealth(c.Request.Context(), ch.ID, result)
	}
	c.JSON(http.StatusOK, result)
}
