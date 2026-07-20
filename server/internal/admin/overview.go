package admin

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"github.com/basketikun/infinite-canvas/server/internal/httpx"
)

// Overview 返回账号、媒体和社区内容概览。模型调用由用户浏览器直连，服务端不记录平台用量。
func (h *Handler) Overview(c *gin.Context) {
	ctx := c.Request.Context()
	var totalUsers, disabledUsers int
	var storageBytes int64
	var storageFiles, contestPending, contestApproved int

	if err := h.pool.QueryRow(ctx,
		`SELECT count(*), count(*) FILTER (WHERE disabled) FROM users`).
		Scan(&totalUsers, &disabledUsers); err != nil {
		httpx.Internal(c, err)
		return
	}
	if err := h.pool.QueryRow(ctx,
		`SELECT count(*), COALESCE(sum(bytes), 0) FROM files`).
		Scan(&storageFiles, &storageBytes); err != nil {
		httpx.Internal(c, err)
		return
	}
	if err := h.pool.QueryRow(ctx,
		`SELECT count(*) FILTER (WHERE status='pending'), count(*) FILTER (WHERE status='approved')
		 FROM creator_contest_entries`).
		Scan(&contestPending, &contestApproved); err != nil {
		httpx.Internal(c, err)
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"users":   gin.H{"total": totalUsers, "disabled": disabledUsers},
		"storage": gin.H{"files": storageFiles, "bytes": storageBytes},
		"content": gin.H{"contestPending": contestPending, "contestApproved": contestApproved},
	})
}
