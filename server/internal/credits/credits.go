// Package credits 提供积分余额的查询、赠送、充值、扣费与流水台账。
// 扣费用单条带条件的 UPDATE 保证原子性：余额不足时不写入，避免并发下扣成负数。
package credits

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ErrInsufficient 表示余额不足以完成本次扣费。
var ErrInsufficient = errors.New("insufficient credits")

// 流水原因常量。
const (
	ReasonRegister = "register"
	ReasonTopup    = "admin_topup"
	ReasonConsume  = "consume"
	ReasonRefund   = "refund"
	// ReasonContestAward 创作者大赛管理员手动结算发放的奖励积分。
	ReasonContestAward = "contest_award"
)

type Service struct {
	pool *pgxpool.Pool
}

func NewService(pool *pgxpool.Pool) *Service { return &Service{pool: pool} }

// Balance 返回用户当前积分余额。
func (s *Service) Balance(ctx context.Context, userID string) (int64, error) {
	var bal int64
	err := s.pool.QueryRow(ctx, `SELECT credits FROM users WHERE id = $1`, userID).Scan(&bal)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, nil
	}
	return bal, err
}

// ledgerEntry 描述一次要写入台账的积分变动。
type ledgerEntry struct {
	Reason     string
	Capability string
	ChannelID  string
	Model      string
	Note       string
}

// apply 在单个事务内原子调整余额并写台账；delta 为负时若余额不足返回 ErrInsufficient。
func (s *Service) apply(ctx context.Context, userID string, delta int64, e ledgerEntry) (int64, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return 0, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var balAfter int64
	// 扣费(delta<0)时加 `credits + delta >= 0` 条件，余额不足则 0 行受影响。
	if delta < 0 {
		err = tx.QueryRow(ctx,
			`UPDATE users SET credits = credits + $2 WHERE id = $1 AND credits + $2 >= 0 RETURNING credits`,
			userID, delta).Scan(&balAfter)
		if errors.Is(err, pgx.ErrNoRows) {
			return 0, ErrInsufficient
		}
	} else {
		err = tx.QueryRow(ctx,
			`UPDATE users SET credits = credits + $2 WHERE id = $1 RETURNING credits`,
			userID, delta).Scan(&balAfter)
		if errors.Is(err, pgx.ErrNoRows) {
			return 0, errors.New("user not found")
		}
	}
	if err != nil {
		return 0, err
	}

	if _, err = tx.Exec(ctx,
		`INSERT INTO credit_ledger (user_id, delta, balance_after, reason, capability, channel_id, model, note)
		 VALUES ($1, $2, $3, $4, $5, NULLIF($6,'')::uuid, $7, $8)`,
		userID, delta, balAfter, e.Reason, e.Capability, e.ChannelID, e.Model, e.Note); err != nil {
		return 0, err
	}
	if err = tx.Commit(ctx); err != nil {
		return 0, err
	}
	return balAfter, nil
}

// Grant 增加积分（赠送/充值），返回操作后余额。
func (s *Service) Grant(ctx context.Context, userID string, amount int64, reason, note string) (int64, error) {
	if amount <= 0 {
		return s.Balance(ctx, userID)
	}
	return s.apply(ctx, userID, amount, ledgerEntry{Reason: reason, Note: note})
}

// Charge 扣减积分；余额不足返回 ErrInsufficient，不产生流水。cost<=0 视为免费直接放行。
func (s *Service) Charge(ctx context.Context, userID string, cost int64, capability, channelID, model string) (int64, error) {
	if cost <= 0 {
		return s.Balance(ctx, userID)
	}
	return s.apply(ctx, userID, -cost, ledgerEntry{
		Reason:     ReasonConsume,
		Capability: capability,
		ChannelID:  channelID,
		Model:      model,
	})
}

// Refund 退款（扣费后上游失败时回补），返回操作后余额。
func (s *Service) Refund(ctx context.Context, userID string, amount int64, capability, channelID, model string) (int64, error) {
	if amount <= 0 {
		return s.Balance(ctx, userID)
	}
	return s.apply(ctx, userID, amount, ledgerEntry{
		Reason:     ReasonRefund,
		Capability: capability,
		ChannelID:  channelID,
		Model:      model,
	})
}

// LedgerItem 是返回给前端的流水条目。
type LedgerItem struct {
	Delta        int64  `json:"delta"`
	BalanceAfter int64  `json:"balanceAfter"`
	Reason       string `json:"reason"`
	Capability   string `json:"capability"`
	Model        string `json:"model"`
	Note         string `json:"note"`
	CreatedAt    string `json:"createdAt"`
}

// History 返回用户最近的积分流水（倒序），limit 上限 200。
func (s *Service) History(ctx context.Context, userID string, limit int) ([]LedgerItem, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	rows, err := s.pool.Query(ctx,
		`SELECT delta, balance_after, reason, capability, model, note, created_at
		 FROM credit_ledger WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2`,
		userID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []LedgerItem{}
	for rows.Next() {
		var it LedgerItem
		var createdAt time.Time
		if err := rows.Scan(&it.Delta, &it.BalanceAfter, &it.Reason, &it.Capability, &it.Model, &it.Note, &createdAt); err != nil {
			return nil, err
		}
		it.CreatedAt = createdAt.Format(time.RFC3339)
		out = append(out, it)
	}
	return out, rows.Err()
}
