// Package credits 的 HTTP 层：面向普通用户的余额查询与流水。
package credits

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"

	"github.com/basketikun/infinite-canvas/server/internal/httpx"
	"github.com/basketikun/infinite-canvas/server/internal/middleware"
)

// Handler 提供 /credits（余额）与 /credits/ledger（流水）。
type Handler struct {
	svc *Service
}

func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

// Balance 返回当前用户积分余额。
func (h *Handler) Balance(c *gin.Context) {
	bal, err := h.svc.Balance(c.Request.Context(), middleware.UserIDFrom(c))
	if err != nil {
		httpx.Internal(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"credits": bal})
}

// Ledger 返回当前用户最近的积分流水。
func (h *Handler) Ledger(c *gin.Context) {
	limit, _ := strconv.Atoi(c.Query("limit"))
	items, err := h.svc.History(c.Request.Context(), middleware.UserIDFrom(c), limit)
	if err != nil {
		httpx.Internal(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": items})
}
