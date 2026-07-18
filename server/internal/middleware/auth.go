// Package middleware 提供鉴权与上下文注入中间件。
package middleware

import (
	"context"
	"strings"

	"github.com/gin-gonic/gin"

	"github.com/basketikun/infinite-canvas/server/internal/auth"
	"github.com/basketikun/infinite-canvas/server/internal/httpx"
)

const (
	ctxUserID = "uid"
	ctxRole   = "role"
)

type SessionChecker interface {
	ValidateSession(ctx context.Context, userID string, sessionVersion int) (role string, err error)
}

// RequireAuth 校验 Authorization: Bearer <access token>，注入 uid/role。
func RequireAuth(mgr *auth.Manager) gin.HandlerFunc {
	return RequireAuthWithSession(mgr, nil)
}

func RequireAuthWithSession(mgr *auth.Manager, checker SessionChecker) gin.HandlerFunc {
	return func(c *gin.Context) {
		h := c.GetHeader("Authorization")
		if !strings.HasPrefix(h, "Bearer ") {
			httpx.Unauthorized(c, "missing bearer token")
			return
		}
		claims, err := mgr.Parse(strings.TrimPrefix(h, "Bearer "))
		if err != nil {
			httpx.Unauthorized(c, "invalid token")
			return
		}
		if claims.Type != "access" {
			httpx.Unauthorized(c, "not an access token")
			return
		}
		role := claims.Role
		if checker != nil {
			var err error
			role, err = checker.ValidateSession(c.Request.Context(), claims.UserID, claims.SessionVersion)
			if err != nil {
				httpx.Unauthorized(c, "session revoked or account unavailable")
				return
			}
		}
		c.Set(ctxUserID, claims.UserID)
		c.Set(ctxRole, role)
		c.Next()
	}
}

// RequireAuthFlexible 与 RequireAuth 相同，但在没有 Authorization 头时回退读取
// x-goog-api-key（裸 token，无 Bearer 前缀）。用于 AI 代理：前端在 backend 模式下按
// 上游格式（openai / gemini）放置凭证——gemini 走 x-goog-api-key、openai 走 Authorization，
// 两者携带的都是用户 JWT，代理层随后会剥离并换成真正的渠道密钥。
func RequireAuthFlexible(mgr *auth.Manager) gin.HandlerFunc {
	return RequireAuthFlexibleWithSession(mgr, nil)
}

func RequireAuthFlexibleWithSession(mgr *auth.Manager, checker SessionChecker) gin.HandlerFunc {
	return func(c *gin.Context) {
		token := ""
		if h := c.GetHeader("Authorization"); strings.HasPrefix(h, "Bearer ") {
			token = strings.TrimPrefix(h, "Bearer ")
		} else if k := c.GetHeader("x-goog-api-key"); k != "" {
			token = k
		}
		if token == "" {
			httpx.Unauthorized(c, "missing bearer token")
			return
		}
		claims, err := mgr.Parse(token)
		if err != nil {
			httpx.Unauthorized(c, "invalid token")
			return
		}
		if claims.Type != "access" {
			httpx.Unauthorized(c, "not an access token")
			return
		}
		role := claims.Role
		if checker != nil {
			var err error
			role, err = checker.ValidateSession(c.Request.Context(), claims.UserID, claims.SessionVersion)
			if err != nil {
				httpx.Unauthorized(c, "session revoked or account unavailable")
				return
			}
		}
		c.Set(ctxUserID, claims.UserID)
		c.Set(ctxRole, role)
		c.Next()
	}
}

// RequireAdmin 必须在 RequireAuth 之后使用。
func RequireAdmin() gin.HandlerFunc {
	return func(c *gin.Context) {
		if role := RoleFrom(c); role != "admin" && role != "operator" {
			httpx.Forbidden(c, "admin only")
			return
		}
		c.Next()
	}
}

func RequireSuperAdmin() gin.HandlerFunc {
	return func(c *gin.Context) {
		if RoleFrom(c) != "admin" {
			httpx.Forbidden(c, "super admin only")
			return
		}
		c.Next()
	}
}

func UserIDFrom(c *gin.Context) string {
	v, _ := c.Get(ctxUserID)
	s, _ := v.(string)
	return s
}

func RoleFrom(c *gin.Context) string {
	v, _ := c.Get(ctxRole)
	s, _ := v.(string)
	return s
}
