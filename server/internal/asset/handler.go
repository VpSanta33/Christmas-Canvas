// Package asset 提供资产的按用户隔离 CRUD，前端 Asset 结构存 JSONB。
package asset

import (
	"encoding/json"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/basketikun/infinite-canvas/server/internal/httpx"
	"github.com/basketikun/infinite-canvas/server/internal/middleware"
)

type Handler struct{ pool *pgxpool.Pool }

func NewHandler(pool *pgxpool.Pool) *Handler { return &Handler{pool: pool} }

type assetPayload struct {
	ID    string          `json:"id"`
	Kind  string          `json:"kind"`
	Title string          `json:"title"`
	Data  json.RawMessage `json:"data"` // 完整前端 Asset
}

func (h *Handler) List(c *gin.Context) {
	uid := middleware.UserIDFrom(c)
	rows, err := h.pool.Query(c.Request.Context(),
		`SELECT data FROM assets WHERE user_id = $1 ORDER BY updated_at DESC`, uid)
	if err != nil {
		httpx.Internal(c, err)
		return
	}
	defer rows.Close()
	out := []json.RawMessage{}
	for rows.Next() {
		var data []byte
		if err := rows.Scan(&data); err != nil {
			httpx.Internal(c, err)
			return
		}
		out = append(out, json.RawMessage(data))
	}
	c.JSON(http.StatusOK, gin.H{"assets": out})
}

func (h *Handler) Upsert(c *gin.Context) {
	uid := middleware.UserIDFrom(c)
	var p assetPayload
	if err := c.ShouldBindJSON(&p); err != nil || p.ID == "" || len(p.Data) == 0 {
		httpx.BadRequest(c, "invalid asset payload")
		return
	}
	_, err := h.pool.Exec(c.Request.Context(),
		`INSERT INTO assets (id, user_id, kind, title, data, updated_at)
		 VALUES ($1, $2, $3, $4, $5, now())
		 ON CONFLICT (id) DO UPDATE SET kind = EXCLUDED.kind, title = EXCLUDED.title, data = EXCLUDED.data, updated_at = now()
		 WHERE assets.user_id = $2`,
		p.ID, uid, p.Kind, p.Title, []byte(p.Data))
	if err != nil {
		httpx.Internal(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (h *Handler) Replace(c *gin.Context) {
	uid := middleware.UserIDFrom(c)
	var body struct {
		Assets []assetPayload `json:"assets"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		httpx.BadRequest(c, "invalid body")
		return
	}
	tx, err := h.pool.Begin(c.Request.Context())
	if err != nil {
		httpx.Internal(c, err)
		return
	}
	defer tx.Rollback(c.Request.Context())
	if _, err := tx.Exec(c.Request.Context(), `DELETE FROM assets WHERE user_id = $1`, uid); err != nil {
		httpx.Internal(c, err)
		return
	}
	for _, p := range body.Assets {
		if p.ID == "" || len(p.Data) == 0 {
			continue
		}
		if _, err := tx.Exec(c.Request.Context(),
			`INSERT INTO assets (id, user_id, kind, title, data) VALUES ($1, $2, $3, $4, $5)`,
			p.ID, uid, p.Kind, p.Title, []byte(p.Data)); err != nil {
			httpx.Internal(c, err)
			return
		}
	}
	if err := tx.Commit(c.Request.Context()); err != nil {
		httpx.Internal(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (h *Handler) Delete(c *gin.Context) {
	uid := middleware.UserIDFrom(c)
	id := c.Param("id")
	tag, err := h.pool.Exec(c.Request.Context(),
		`DELETE FROM assets WHERE id = $1 AND user_id = $2`, id, uid)
	if err != nil {
		httpx.Internal(c, err)
		return
	}
	if tag.RowsAffected() == 0 {
		httpx.NotFound(c, "asset not found")
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}
