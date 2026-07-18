package middleware

import (
	"crypto/rand"
	"encoding/hex"
	"strings"

	"github.com/gin-gonic/gin"

	"github.com/basketikun/infinite-canvas/server/internal/httpx"
)

const requestIDHeader = "X-Request-ID"

func RequestID() gin.HandlerFunc {
	return func(c *gin.Context) {
		requestID := strings.TrimSpace(c.GetHeader(requestIDHeader))
		if requestID == "" || len(requestID) > 128 {
			var value [16]byte
			if _, err := rand.Read(value[:]); err == nil {
				requestID = hex.EncodeToString(value[:])
			} else {
				requestID = "unavailable"
			}
		}
		c.Header(requestIDHeader, requestID)
		c.Next()
	}
}

func RequestIDFrom(c *gin.Context) string { return c.Writer.Header().Get(requestIDHeader) }

// RequireAdminConfirmation 为高风险写操作增加服务端确认门槛，避免绕过前端确认框误触。
func RequireAdminConfirmation() gin.HandlerFunc {
	return func(c *gin.Context) {
		if c.GetHeader("X-Admin-Confirm") != "confirmed" {
			httpx.BadRequest(c, "high-risk operation requires confirmation")
			return
		}
		c.Next()
	}
}
