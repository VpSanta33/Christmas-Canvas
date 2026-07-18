package admin

import (
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/basketikun/infinite-canvas/server/internal/httpx"
)

type auditLog struct {
	ID         int64  `json:"id"`
	ActorID    string `json:"actorId"`
	ActorEmail string `json:"actorEmail"`
	ActorRole  string `json:"actorRole"`
	Action     string `json:"action"`
	Target     string `json:"target"`
	RequestID  string `json:"requestId"`
	HTTPStatus int    `json:"httpStatus"`
	IPAddress  string `json:"ipAddress"`
	UserAgent  string `json:"userAgent"`
	CreatedAt  string `json:"createdAt"`
}

func (h *Handler) AuditLogs(c *gin.Context) {
	limit, _ := strconv.Atoi(c.Query("limit"))
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	query := strings.TrimSpace(c.Query("q"))
	rows, err := h.pool.Query(c.Request.Context(),
		`SELECT id, COALESCE(actor_id::text, ''), actor_email, actor_role, action,
		        target, request_id, http_status, ip_address, user_agent, created_at
		 FROM admin_audit_logs
		 WHERE $1 = '' OR actor_email ILIKE '%' || $1 || '%' OR action ILIKE '%' || $1 || '%'
		                 OR target ILIKE '%' || $1 || '%' OR request_id = $1
		 ORDER BY created_at DESC LIMIT $2`, query, limit)
	if err != nil {
		httpx.Internal(c, err)
		return
	}
	defer rows.Close()
	items := []auditLog{}
	for rows.Next() {
		var item auditLog
		var created time.Time
		if err := rows.Scan(&item.ID, &item.ActorID, &item.ActorEmail, &item.ActorRole,
			&item.Action, &item.Target, &item.RequestID, &item.HTTPStatus,
			&item.IPAddress, &item.UserAgent, &created); err != nil {
			httpx.Internal(c, err)
			return
		}
		item.CreatedAt = created.Format(time.RFC3339)
		items = append(items, item)
	}
	c.JSON(http.StatusOK, gin.H{"items": items})
}

func (h *Handler) RevokeUserSessions(c *gin.Context) {
	if err := mapUserErr(c, h.users.RevokeSessions(c.Request.Context(), c.Param("id"))); err {
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}
