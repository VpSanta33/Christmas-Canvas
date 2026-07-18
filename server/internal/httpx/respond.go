// Package httpx 提供统一的 JSON 响应与错误处理辅助。
package httpx

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

type ErrorBody struct {
	Error string `json:"error"`
	Code  string `json:"code,omitempty"`
}

// Fail 以给定状态码返回 {"error": msg}。
func Fail(c *gin.Context, status int, msg string) {
	c.AbortWithStatusJSON(status, ErrorBody{Error: msg})
}

// FailCode 为需要前端稳定分支处理的错误附带机器可读 code，避免依赖提示文案。
func FailCode(c *gin.Context, status int, code, msg string) {
	c.AbortWithStatusJSON(status, ErrorBody{Error: msg, Code: code})
}

func BadRequest(c *gin.Context, msg string) { Fail(c, http.StatusBadRequest, msg) }
func Unauthorized(c *gin.Context, msg string) {
	if msg == "" {
		msg = "unauthorized"
	}
	Fail(c, http.StatusUnauthorized, msg)
}
func Forbidden(c *gin.Context, msg string) { Fail(c, http.StatusForbidden, msg) }
func NotFound(c *gin.Context, msg string)  { Fail(c, http.StatusNotFound, msg) }
func Internal(c *gin.Context, err error) {
	Fail(c, http.StatusInternalServerError, err.Error())
}
