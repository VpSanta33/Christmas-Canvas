package storage

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"github.com/basketikun/infinite-canvas/server/internal/httpx"
)

type AdminHandler struct{ manager *Manager }

func NewAdminHandler(manager *Manager) *AdminHandler { return &AdminHandler{manager: manager} }

func (h *AdminHandler) Get(c *gin.Context) {
	c.JSON(http.StatusOK, h.manager.AdminSettings())
}

func (h *AdminHandler) Update(c *gin.Context) {
	var settings SettingsUpdate
	if err := c.ShouldBindJSON(&settings); err != nil {
		httpx.BadRequest(c, "invalid storage settings")
		return
	}
	if err := h.manager.Update(c.Request.Context(), settings); err != nil {
		httpx.BadRequest(c, err.Error())
		return
	}
	c.JSON(http.StatusOK, h.manager.AdminSettings())
}

func (h *AdminHandler) Test(c *gin.Context) {
	var settings SettingsUpdate
	if err := c.ShouldBindJSON(&settings); err != nil {
		httpx.BadRequest(c, "invalid storage settings")
		return
	}
	if err := h.manager.Test(c.Request.Context(), settings); err != nil {
		httpx.BadRequest(c, err.Error())
		return
	}
	current := h.manager.AdminSettings()
	c.JSON(http.StatusOK, gin.H{"ok": true, "message": "连接测试通过，已验证 " + current.ImagePathPrefix + "/ 与 " + current.VideoPathPrefix + "/ 的写入和删除权限"})
}

func (h *AdminHandler) CleanupStats(c *gin.Context) {
	stats, err := h.manager.CleanupStats(c.Request.Context())
	if err != nil {
		httpx.Internal(c, err)
		return
	}
	c.JSON(http.StatusOK, stats)
}

func (h *AdminHandler) PurgeExpired(c *gin.Context) {
	result, err := h.manager.PurgeExpired(c.Request.Context())
	if err != nil {
		httpx.Internal(c, err)
		return
	}
	c.JSON(http.StatusOK, result)
}
