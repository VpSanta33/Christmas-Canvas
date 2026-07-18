package admin

import (
	"context"
	"net/http"

	"github.com/gin-gonic/gin"

	"github.com/basketikun/infinite-canvas/server/internal/httpx"
)

// Overview 返回系统概览：用户数、渠道数、今日/近 7 日 AI 调用量。
func (h *Handler) Overview(c *gin.Context) {
	ctx := c.Request.Context()
	var totalUsers, disabledUsers, totalChannels, enabledChannels, usageToday, usage7d int
	var successToday, errorsToday int
	var credits7d, storageBytes int64
	var storageFiles, contestPending, contestApproved int
	// 用户
	if err := h.pool.QueryRow(ctx,
		`SELECT count(*), count(*) FILTER (WHERE disabled) FROM users`).
		Scan(&totalUsers, &disabledUsers); err != nil {
		httpx.Internal(c, err)
		return
	}
	// 渠道
	if err := h.pool.QueryRow(ctx,
		`SELECT count(*), count(*) FILTER (WHERE enabled) FROM channels`).
		Scan(&totalChannels, &enabledChannels); err != nil {
		httpx.Internal(c, err)
		return
	}
	// 用量
	if err := h.pool.QueryRow(ctx,
		`SELECT
		   count(*) FILTER (WHERE created_at >= date_trunc('day', now())),
		   count(*) FILTER (WHERE created_at >= now() - interval '7 days'),
		   count(*) FILTER (WHERE created_at >= date_trunc('day', now()) AND status = 'ok'),
		   count(*) FILTER (WHERE created_at >= date_trunc('day', now()) AND status <> 'ok')
		 FROM usage_records`).
		Scan(&usageToday, &usage7d, &successToday, &errorsToday); err != nil {
		httpx.Internal(c, err)
		return
	}
	if err := h.pool.QueryRow(ctx,
		`SELECT COALESCE(sum(-delta) FILTER (WHERE delta < 0 AND created_at >= now() - interval '7 days'), 0)
		 FROM credit_ledger`).Scan(&credits7d); err != nil {
		httpx.Internal(c, err)
		return
	}
	if err := h.pool.QueryRow(ctx, `SELECT count(*), COALESCE(sum(bytes), 0) FROM files`).Scan(&storageFiles, &storageBytes); err != nil {
		httpx.Internal(c, err)
		return
	}
	if err := h.pool.QueryRow(ctx,
		`SELECT count(*) FILTER (WHERE status='pending'), count(*) FILTER (WHERE status='approved')
		 FROM creator_contest_entries`).Scan(&contestPending, &contestApproved); err != nil {
		httpx.Internal(c, err)
		return
	}
	successRate := 100.0
	if usageToday > 0 {
		successRate = float64(successToday) * 100 / float64(usageToday)
	}
	c.JSON(http.StatusOK, gin.H{
		"users":    gin.H{"total": totalUsers, "disabled": disabledUsers},
		"channels": gin.H{"total": totalChannels, "enabled": enabledChannels},
		"usage":    gin.H{"today": usageToday, "last7Days": usage7d, "errorsToday": errorsToday, "successRate": successRate},
		"credits":  gin.H{"consumedLast7Days": credits7d},
		"storage":  gin.H{"files": storageFiles, "bytes": storageBytes},
		"content":  gin.H{"contestPending": contestPending, "contestApproved": contestApproved},
	})
}

type usageDailyPoint struct {
	Date  string `json:"date"`
	Count int    `json:"count"`
}

type usageCapPoint struct {
	Capability string `json:"capability"`
	Count      int    `json:"count"`
}

type usageChannelPoint struct {
	ChannelID string `json:"channelId"`
	Name      string `json:"name"`
	Count     int    `json:"count"`
}

// Usage 返回近 N 天（默认 14，最多 90）的每日用量趋势与按能力/渠道维度的分布。
func (h *Handler) Usage(c *gin.Context) {
	ctx := c.Request.Context()
	days := 14
	if q := c.Query("days"); q != "" {
		if n, ok := parsePositiveInt(q); ok {
			days = n
		}
	}
	if days > 90 {
		days = 90
	}

	daily, err := h.usageDaily(ctx, days)
	if err != nil {
		httpx.Internal(c, err)
		return
	}
	byCap, err := h.usageByCapability(ctx, days)
	if err != nil {
		httpx.Internal(c, err)
		return
	}
	byChannel, err := h.usageByChannel(ctx, days)
	if err != nil {
		httpx.Internal(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"daily": daily, "byCapability": byCap, "byChannel": byChannel, "days": days})
}

// usageDaily 用 generate_series 补齐无调用的空白日期，前端图表不会断线。
func (h *Handler) usageDaily(ctx context.Context, days int) ([]usageDailyPoint, error) {
	rows, err := h.pool.Query(ctx,
		`SELECT to_char(d.day, 'YYYY-MM-DD'), COALESCE(u.cnt, 0)
		 FROM generate_series(
		        date_trunc('day', now()) - make_interval(days => $1 - 1),
		        date_trunc('day', now()),
		        interval '1 day') AS d(day)
		 LEFT JOIN (
		        SELECT date_trunc('day', created_at) AS day, count(*) AS cnt
		        FROM usage_records
		        WHERE created_at >= date_trunc('day', now()) - make_interval(days => $1 - 1)
		        GROUP BY 1
		 ) u ON u.day = d.day
		 ORDER BY d.day`, days)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []usageDailyPoint{}
	for rows.Next() {
		var p usageDailyPoint
		if err := rows.Scan(&p.Date, &p.Count); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

func (h *Handler) usageByCapability(ctx context.Context, days int) ([]usageCapPoint, error) {
	rows, err := h.pool.Query(ctx,
		`SELECT capability, count(*) FROM usage_records
		 WHERE created_at >= date_trunc('day', now()) - make_interval(days => $1 - 1)
		 GROUP BY capability ORDER BY count(*) DESC`, days)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []usageCapPoint{}
	for rows.Next() {
		var p usageCapPoint
		if err := rows.Scan(&p.Capability, &p.Count); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// usageByChannel 按渠道聚合调用次数；LEFT JOIN channels 补出渠道名，已删除的渠道显示为"（已删除）"。
func (h *Handler) usageByChannel(ctx context.Context, days int) ([]usageChannelPoint, error) {
	rows, err := h.pool.Query(ctx,
		`SELECT COALESCE(r.channel_id::text, ''), COALESCE(c.name, ''), count(*)
		 FROM usage_records r
		 LEFT JOIN channels c ON c.id = r.channel_id
		 WHERE r.created_at >= date_trunc('day', now()) - make_interval(days => $1 - 1)
		 GROUP BY r.channel_id, c.name ORDER BY count(*) DESC`, days)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []usageChannelPoint{}
	for rows.Next() {
		var p usageChannelPoint
		if err := rows.Scan(&p.ChannelID, &p.Name, &p.Count); err != nil {
			return nil, err
		}
		if p.Name == "" {
			p.Name = "（已删除渠道）"
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// parsePositiveInt 解析正整数查询参数。
func parsePositiveInt(s string) (int, bool) {
	n := 0
	for _, r := range s {
		if r < '0' || r > '9' {
			return 0, false
		}
		n = n*10 + int(r-'0')
		if n > 1_000_000 {
			return 0, false
		}
	}
	if n <= 0 {
		return 0, false
	}
	return n, true
}
