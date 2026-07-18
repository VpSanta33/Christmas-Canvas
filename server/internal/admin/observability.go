package admin

import (
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/basketikun/infinite-canvas/server/internal/httpx"
)

type callLog struct {
	ID           int64  `json:"id"`
	RequestID    string `json:"requestId"`
	UserID       string `json:"userId"`
	UserEmail    string `json:"userEmail"`
	Capability   string `json:"capability"`
	ChannelID    string `json:"channelId"`
	ChannelName  string `json:"channelName"`
	Model        string `json:"model"`
	Status       string `json:"status"`
	HTTPStatus   int    `json:"httpStatus"`
	LatencyMs    int64  `json:"latencyMs"`
	Credits      int64  `json:"credits"`
	Refunded     bool   `json:"refunded"`
	ErrorMessage string `json:"errorMessage"`
	CreatedAt    string `json:"createdAt"`
}

// CallLogs 返回全平台调用流水。只允许按安全元数据排障，不返回提示词或请求正文。
func (h *Handler) CallLogs(c *gin.Context) {
	limit, _ := strconv.Atoi(c.Query("limit"))
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	status := strings.TrimSpace(c.Query("status"))
	channelID := strings.TrimSpace(c.Query("channelId"))
	query := strings.TrimSpace(c.Query("q"))
	rows, err := h.pool.Query(c.Request.Context(),
		`SELECT r.id, r.request_id, r.user_id::text, u.email,
		        r.capability, COALESCE(r.channel_id::text, ''), COALESCE(ch.name, ''),
		        r.model, r.status, r.http_status, r.latency_ms, r.credits, r.refunded,
		        r.error_message, r.created_at
		 FROM usage_records r
		 JOIN users u ON u.id = r.user_id
		 LEFT JOIN channels ch ON ch.id = r.channel_id
		 WHERE ($1 = '' OR r.status = $1)
		   AND ($2 = '' OR r.channel_id = NULLIF($2, '')::uuid)
		   AND ($3 = '' OR r.request_id = $3 OR r.model ILIKE '%' || $3 || '%'
		                OR u.email ILIKE '%' || $3 || '%' OR ch.name ILIKE '%' || $3 || '%')
		 ORDER BY r.created_at DESC LIMIT $4`, status, channelID, query, limit)
	if err != nil {
		httpx.Internal(c, err)
		return
	}
	defer rows.Close()
	items := []callLog{}
	for rows.Next() {
		var item callLog
		var created time.Time
		if err := rows.Scan(&item.ID, &item.RequestID, &item.UserID, &item.UserEmail,
			&item.Capability, &item.ChannelID, &item.ChannelName, &item.Model,
			&item.Status, &item.HTTPStatus, &item.LatencyMs, &item.Credits,
			&item.Refunded, &item.ErrorMessage, &created); err != nil {
			httpx.Internal(c, err)
			return
		}
		item.CreatedAt = created.Format(time.RFC3339)
		items = append(items, item)
	}
	c.JSON(http.StatusOK, gin.H{"items": items})
}

type channelHealthSummary struct {
	ChannelID       string  `json:"channelId"`
	Name            string  `json:"name"`
	Enabled         bool    `json:"enabled"`
	AutoPaused      bool    `json:"autoPaused"`
	PausedReason    string  `json:"pausedReason"`
	Calls24h        int     `json:"calls24h"`
	SuccessRate     float64 `json:"successRate"`
	AverageLatency  int64   `json:"averageLatencyMs"`
	RefundedCredits int64   `json:"refundedCredits"`
	LastError       string  `json:"lastError"`
	LastSeenAt      string  `json:"lastSeenAt"`
	Severity        string  `json:"severity"`
}

func (h *Handler) ChannelHealth(c *gin.Context) {
	rows, err := h.pool.Query(c.Request.Context(),
		`SELECT ch.id::text, ch.name, ch.enabled, ch.auto_paused, ch.paused_reason,
		        count(r.id),
		        COALESCE(100.0 * count(r.id) FILTER (WHERE r.status = 'ok') / NULLIF(count(r.id), 0), 100),
		        COALESCE(avg(r.latency_ms), 0)::bigint,
		        COALESCE(sum(r.credits) FILTER (WHERE r.refunded), 0),
		        COALESCE((SELECT error_message FROM usage_records e
		                  WHERE e.channel_id=ch.id AND e.status IN ('error', 'timeout')
		                  ORDER BY e.created_at DESC LIMIT 1), ''),
		        max(r.created_at)
		 FROM channels ch
		 LEFT JOIN usage_records r ON r.channel_id=ch.id
		        AND r.status IN ('ok', 'error', 'timeout')
		        AND r.created_at >= now() - interval '24 hours'
		 GROUP BY ch.id, ch.name, ch.enabled, ch.auto_paused, ch.paused_reason
		 ORDER BY ch.auto_paused DESC, ch.enabled DESC, ch.name`)
	if err != nil {
		httpx.Internal(c, err)
		return
	}
	defer rows.Close()
	items := []channelHealthSummary{}
	for rows.Next() {
		var item channelHealthSummary
		var lastSeen *time.Time
		if err := rows.Scan(&item.ChannelID, &item.Name, &item.Enabled, &item.AutoPaused,
			&item.PausedReason, &item.Calls24h, &item.SuccessRate, &item.AverageLatency,
			&item.RefundedCredits, &item.LastError, &lastSeen); err != nil {
			httpx.Internal(c, err)
			return
		}
		if lastSeen != nil {
			item.LastSeenAt = lastSeen.Format(time.RFC3339)
		}
		item.Severity = healthSeverity(item)
		items = append(items, item)
	}
	c.JSON(http.StatusOK, gin.H{"items": items})
}

func healthSeverity(item channelHealthSummary) string {
	if item.AutoPaused || (!item.Enabled && item.PausedReason != "") {
		return "critical"
	}
	if item.Calls24h >= 3 && item.SuccessRate < 80 {
		return "warning"
	}
	return "healthy"
}
