// Package quota 只提供认证端点和用户请求的 Redis 限流。
package quota

import (
	"fmt"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/redis/go-redis/v9"

	"github.com/basketikun/infinite-canvas/server/internal/httpx"
	"github.com/basketikun/infinite-canvas/server/internal/middleware"
)

type Service struct {
	rdb *redis.Client
}

func NewService(rdb *redis.Client) *Service {
	return &Service{rdb: rdb}
}

// RateLimit 基于 Redis 固定窗口，每用户每分钟 limit 次。Redis 不可用时放行（fail-open）。
func (s *Service) RateLimit(limitPerMin int) gin.HandlerFunc {
	return func(c *gin.Context) {
		uid := middleware.UserIDFrom(c)
		if uid == "" || s.rdb == nil {
			c.Next()
			return
		}
		key := fmt.Sprintf("rl:%s:%d", uid, time.Now().Unix()/60)
		n, err := s.rdb.Incr(c.Request.Context(), key).Result()
		if err != nil {
			c.Next() // fail-open
			return
		}
		if n == 1 {
			s.rdb.Expire(c.Request.Context(), key, 90*time.Second)
		}
		if n > int64(limitPerMin) {
			httpx.Fail(c, http.StatusTooManyRequests, "rate limit exceeded")
			return
		}
		c.Next()
	}
}

// RateLimitByIP 基于 Redis 固定窗口，按客户端 IP + 路由分组限流，用于登录/注册等未鉴权端点，
// 抵御暴力破解。Redis 不可用时放行（fail-open）。scope 用于区分不同端点的计数桶。
func (s *Service) RateLimitByIP(scope string, limitPerMin int) gin.HandlerFunc {
	return func(c *gin.Context) {
		if s.rdb == nil {
			c.Next()
			return
		}
		key := fmt.Sprintf("rlip:%s:%s:%d", scope, c.ClientIP(), time.Now().Unix()/60)
		n, err := s.rdb.Incr(c.Request.Context(), key).Result()
		if err != nil {
			c.Next() // fail-open
			return
		}
		if n == 1 {
			s.rdb.Expire(c.Request.Context(), key, 90*time.Second)
		}
		if n > int64(limitPerMin) {
			httpx.Fail(c, http.StatusTooManyRequests, "too many attempts, slow down")
			return
		}
		c.Next()
	}
}
