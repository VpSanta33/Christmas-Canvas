// Package audit 记录管理员写操作，不采集请求正文、密码、提示词或 API Key。
package audit

import (
	"context"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/basketikun/infinite-canvas/server/internal/middleware"
)

func Middleware(pool *pgxpool.Pool) gin.HandlerFunc {
	return func(c *gin.Context) {
		if c.Request.Method == http.MethodGet || c.Request.Method == http.MethodHead || c.Request.Method == http.MethodOptions {
			c.Next()
			return
		}
		c.Next()

		actorID := middleware.UserIDFrom(c)
		actorRole := middleware.RoleFrom(c)
		path := c.FullPath()
		if path == "" {
			path = c.Request.URL.Path
		}
		target := c.Param("id")
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		var email string
		_ = pool.QueryRow(ctx, `SELECT email FROM users WHERE id=$1`, actorID).Scan(&email)
		_, _ = pool.Exec(ctx,
			`INSERT INTO admin_audit_logs (
			    actor_id, actor_email, actor_role, action, target, request_id,
			    http_status, ip_address, user_agent
			 ) VALUES (NULLIF($1,'')::uuid, $2, $3, $4, $5, $6, $7, $8, $9)`,
			actorID, email, actorRole, c.Request.Method+" "+path, target,
			middleware.RequestIDFrom(c), c.Writer.Status(), truncate(c.ClientIP(), 128),
			truncate(strings.TrimSpace(c.Request.UserAgent()), 500),
		)
	}
}

func truncate(value string, max int) string {
	if len(value) <= max {
		return value
	}
	return value[:max]
}
