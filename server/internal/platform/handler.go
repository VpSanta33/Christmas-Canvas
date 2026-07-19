package platform

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"github.com/basketikun/infinite-canvas/server/internal/httpx"
)

type Handler struct{ store *Store }

func NewHandler(store *Store) *Handler { return &Handler{store: store} }

func (h *Handler) Public(c *gin.Context) {
	settings, err := h.store.Public(c.Request.Context())
	if err != nil {
		httpx.Internal(c, err)
		return
	}
	hasUsers, err := h.store.HasUsers(c.Request.Context())
	if err != nil {
		httpx.Internal(c, err)
		return
	}
	if !hasUsers {
		settings = applyFirstUserDefaults(settings)
		c.JSON(http.StatusOK, settings)
		return
	}
	settings.EmailVerificationRequired, err = h.store.EmailVerificationEnabled(c.Request.Context())
	if err != nil {
		httpx.Internal(c, err)
		return
	}
	c.JSON(http.StatusOK, settings)
}

func applyFirstUserDefaults(settings PublicSettings) PublicSettings {
	settings.AllowRegistration = true
	settings.EmailVerificationRequired = false
	return settings
}

func (h *Handler) AdminGet(c *gin.Context) {
	settings, err := h.store.Site(c.Request.Context())
	if err != nil {
		httpx.Internal(c, err)
		return
	}
	c.JSON(http.StatusOK, settings)
}

func (h *Handler) AdminUpdate(c *gin.Context) {
	var settings SiteSettings
	if err := c.ShouldBindJSON(&settings); err != nil {
		httpx.BadRequest(c, "invalid platform settings")
		return
	}
	if err := h.store.UpdateSite(c.Request.Context(), settings); err != nil {
		httpx.Internal(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (h *Handler) AdminGetAnnouncements(c *gin.Context) {
	settings, err := h.store.Announcements(c.Request.Context())
	if err != nil {
		httpx.Internal(c, err)
		return
	}
	c.JSON(http.StatusOK, settings)
}

func (h *Handler) AdminUpdateAnnouncements(c *gin.Context) {
	var settings AnnouncementSettings
	if err := c.ShouldBindJSON(&settings); err != nil {
		httpx.BadRequest(c, "invalid announcement settings")
		return
	}
	if err := h.store.UpdateAnnouncements(c.Request.Context(), settings); err != nil {
		httpx.Internal(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (h *Handler) AdminGetEmail(c *gin.Context) {
	settings, err := h.store.AdminEmailSettings(c.Request.Context())
	if err != nil {
		httpx.Internal(c, err)
		return
	}
	c.JSON(http.StatusOK, settings)
}

func (h *Handler) AdminUpdateEmail(c *gin.Context) {
	var settings EmailSettingsUpdate
	if err := c.ShouldBindJSON(&settings); err != nil {
		httpx.BadRequest(c, "invalid email settings")
		return
	}
	if err := h.store.UpdateEmailSettings(c.Request.Context(), settings); err != nil {
		httpx.BadRequest(c, err.Error())
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (h *Handler) AdminTestEmail(c *gin.Context) {
	var req struct {
		Email string `json:"email"`
	}
	if err := c.ShouldBindJSON(&req); err != nil || req.Email == "" {
		httpx.BadRequest(c, "test email required")
		return
	}
	if err := h.store.SendTestEmail(c.Request.Context(), req.Email); err != nil {
		httpx.BadRequest(c, err.Error())
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}
