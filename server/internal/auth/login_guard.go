package auth

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/redis/go-redis/v9"
)

// 登录防爆破：同一账号连续失败达到 maxLoginFailures 次后，锁定 loginLockWindow。
// 计数与锁定状态都放 Redis；Redis 不可用时 fail-open（不锁定，退回 IP 限流兜底）。
const (
	maxLoginFailures = 5
	loginLockWindow  = 10 * time.Minute
)

// LoginGuard 用 Redis 记录每个账号的登录失败次数并在超限时锁定账号。
type LoginGuard struct {
	rdb         *redis.Client
	maxFailures int64
	lockWindow  time.Duration
}

// NewLoginGuard 创建守卫。rdb 为 nil 时所有方法都是空操作（fail-open）。
func NewLoginGuard(rdb *redis.Client) *LoginGuard {
	return &LoginGuard{rdb: rdb, maxFailures: maxLoginFailures, lockWindow: loginLockWindow}
}

func (g *LoginGuard) failKey(email string) string { return "login_fail:" + email }
func (g *LoginGuard) lockKey(email string) string { return "login_lock:" + email }

// Locked 报告账号当前是否处于锁定期，并返回剩余锁定时长。
func (g *LoginGuard) Locked(ctx context.Context, email string) (bool, time.Duration) {
	if g == nil || g.rdb == nil {
		return false, 0
	}
	ttl, err := g.rdb.TTL(ctx, g.lockKey(email)).Result()
	if err != nil || ttl <= 0 {
		return false, 0
	}
	return true, ttl
}

// RecordFailure 记一次失败。达到阈值时写入锁定标记并清空计数，返回是否刚触发锁定。
func (g *LoginGuard) RecordFailure(ctx context.Context, email string) (locked bool, retryAfter time.Duration) {
	if g == nil || g.rdb == nil {
		return false, 0
	}
	key := g.failKey(email)
	n, err := g.rdb.Incr(ctx, key).Result()
	if err != nil {
		return false, 0 // fail-open
	}
	if n == 1 {
		// 计数窗口与锁定时长一致：10 分钟内累计到阈值才锁定。
		g.rdb.Expire(ctx, key, g.lockWindow)
	}
	if n >= g.maxFailures {
		if err := g.rdb.Set(ctx, g.lockKey(email), "1", g.lockWindow).Err(); err != nil {
			return false, 0
		}
		g.rdb.Del(ctx, key)
		return true, g.lockWindow
	}
	return false, 0
}

// Reset 在登录成功后清除失败计数与锁定标记。
func (g *LoginGuard) Reset(ctx context.Context, email string) {
	if g == nil || g.rdb == nil {
		return
	}
	g.rdb.Del(ctx, g.failKey(email), g.lockKey(email))
}

// ErrAccountLocked 由 Login 在账号锁定时用于构造响应文案。
var ErrAccountLocked = errors.New("account locked")

// lockMessage 生成面向用户的锁定提示（向上取整到分钟）。
func lockMessage(retryAfter time.Duration) string {
	minutes := int(retryAfter.Minutes())
	if retryAfter%time.Minute != 0 {
		minutes++
	}
	if minutes < 1 {
		minutes = 1
	}
	return fmt.Sprintf("账号已被锁定，请 %d 分钟后再试", minutes)
}
