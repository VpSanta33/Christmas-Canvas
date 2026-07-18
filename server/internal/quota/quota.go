// Package quota 提供用量记录、配额检查与基于 Redis 的限流。
package quota

import (
	"context"
	"fmt"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"

	"github.com/basketikun/infinite-canvas/server/internal/httpx"
	"github.com/basketikun/infinite-canvas/server/internal/middleware"
)

type Service struct {
	pool            *pgxpool.Pool
	rdb             *redis.Client
	autoPausePolicy AutoPausePolicy
}

type AutoPausePolicy interface {
	AutoPausePolicy(ctx context.Context) (enabled bool, failures int, err error)
}

func NewService(pool *pgxpool.Pool, rdb *redis.Client) *Service {
	return &Service{pool: pool, rdb: rdb}
}

func (s *Service) SetAutoPausePolicy(policy AutoPausePolicy) { s.autoPausePolicy = policy }

// UsageEvent 描述一次 AI 调用的结果，用于落库与 admin 排障。
type UsageEvent struct {
	UserID       string
	Capability   string
	ChannelID    string
	Model        string
	Status       string // ok | error | timeout | cancelled | rejected
	HTTPStatus   int
	ErrorMessage string
	RequestID    string
	LatencyMs    int64
	Credits      int64
	Refunded     bool
}

// Record 记录一次用量（实现 proxy.UsageRecorder）。使用独立的后台 context 而非请求
// context：转发是流式的，请求 context 会在响应写完（或客户端断开）时取消，若沿用它，
// 写入可能在 INSERT 落库前被取消而丢失计量。这里用带超时的 background context 兜底。
func (s *Service) Record(_ context.Context, ev UsageEvent) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	status := ev.Status
	if status == "" {
		status = "ok"
	}
	// 错误信息截断，避免上游返回超长正文塞满列。
	msg := ev.ErrorMessage
	if len(msg) > 2000 {
		msg = msg[:2000]
	}
	_, _ = s.pool.Exec(ctx,
		`INSERT INTO usage_records (
		    user_id, capability, channel_id, model, status, http_status, error_message,
		    request_id, latency_ms, credits, refunded
		 ) VALUES ($1, $2, NULLIF($3,'')::uuid, $4, $5, $6, $7, $8, $9, $10, $11)`,
		ev.UserID, ev.Capability, ev.ChannelID, ev.Model, status, ev.HTTPStatus, msg,
		ev.RequestID, max64(ev.LatencyMs, 0), max64(ev.Credits, 0), ev.Refunded)
	if ev.ChannelID != "" {
		_, _ = s.pool.Exec(ctx, `UPDATE channels SET health_updated_at=now() WHERE id=$1`, ev.ChannelID)
	}
	if status == "error" || status == "timeout" {
		s.maybeAutoPause(ctx, ev.ChannelID)
	}
}

func (s *Service) maybeAutoPause(ctx context.Context, channelID string) {
	if channelID == "" || s.autoPausePolicy == nil {
		return
	}
	enabled, threshold, err := s.autoPausePolicy.AutoPausePolicy(ctx)
	if err != nil || !enabled || threshold < 2 {
		return
	}
	var shouldPause bool
	err = s.pool.QueryRow(ctx,
		`SELECT count(*) = $2 AND bool_and(status <> 'ok')
		 FROM (
		    SELECT status FROM usage_records
		    WHERE channel_id=$1 AND status IN ('ok', 'error', 'timeout')
		    ORDER BY created_at DESC LIMIT $2
		 ) recent`, channelID, threshold).Scan(&shouldPause)
	if err != nil || !shouldPause {
		return
	}
	_, _ = s.pool.Exec(ctx,
		`UPDATE channels SET enabled=false, auto_paused=true,
		        paused_reason=$2, health_updated_at=now()
		 WHERE id=$1 AND enabled=true`, channelID,
		fmt.Sprintf("连续 %d 次调用失败，系统已自动暂停", threshold))
}

func max64(value, min int64) int64 {
	if value < min {
		return min
	}
	return value
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

// dailyUsage 返回当日已用次数与每日上限（缺省 50）。
func (s *Service) dailyUsage(ctx context.Context, userID string) (used, limit int, err error) {
	err = s.pool.QueryRow(ctx,
		`SELECT
		   (SELECT count(DISTINCT COALESCE(NULLIF(request_id, ''), id::text))
		    FROM usage_records WHERE user_id = $1 AND status <> 'rejected'
		      AND created_at >= date_trunc('day', now())),
		   COALESCE((SELECT daily_limit FROM user_quotas WHERE user_id = $1), 50)`,
		userID).Scan(&used, &limit)
	return used, limit, err
}

// CheckDailyQuota 校验当日 AI 调用不超过 daily_limit。
func (s *Service) CheckDailyQuota() gin.HandlerFunc {
	return func(c *gin.Context) {
		uid := middleware.UserIDFrom(c)
		used, limit, err := s.dailyUsage(c.Request.Context(), uid)
		if err != nil {
			c.Next() // fail-open on error
			return
		}
		if used >= limit {
			httpx.Fail(c, http.StatusTooManyRequests, "daily quota exceeded")
			return
		}
		c.Next()
	}
}

// Summary 返回当前用户当日用量与配额，供前端顶栏展示。
func (s *Service) Summary(c *gin.Context) {
	uid := middleware.UserIDFrom(c)
	used, limit, err := s.dailyUsage(c.Request.Context(), uid)
	if err != nil {
		httpx.Internal(c, err)
		return
	}
	remaining := limit - used
	if remaining < 0 {
		remaining = 0
	}
	c.JSON(http.StatusOK, gin.H{"used": used, "limit": limit, "remaining": remaining})
}
