// Package canvas 提供画布项目的按用户隔离 CRUD，整个前端 CanvasProject 存 JSONB。
package canvas

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

// project 是入库/出库的信封：id/title/updatedAt 提取为列，其余整体存 data JSONB。
type projectPayload struct {
	ID    string          `json:"id"`
	Title string          `json:"title"`
	Data  json.RawMessage `json:"data"` // 完整的前端 CanvasProject
}

// List 返回当前用户的全部项目（完整 data）。
func (h *Handler) List(c *gin.Context) {
	uid := middleware.UserIDFrom(c)
	rows, err := h.pool.Query(c.Request.Context(),
		`SELECT data FROM canvas_projects WHERE user_id = $1 ORDER BY updated_at DESC`, uid)
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
	c.JSON(http.StatusOK, gin.H{"projects": out})
}

// Upsert 按 id 插入或更新单个项目。
func (h *Handler) Upsert(c *gin.Context) {
	uid := middleware.UserIDFrom(c)
	var p projectPayload
	if err := c.ShouldBindJSON(&p); err != nil || p.ID == "" || len(p.Data) == 0 {
		httpx.BadRequest(c, "invalid project payload")
		return
	}
	_, err := h.pool.Exec(c.Request.Context(),
		`INSERT INTO canvas_projects (id, user_id, title, data, updated_at)
		 VALUES ($1, $2, $3, $4, now())
		 ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, data = EXCLUDED.data, updated_at = now()
		 WHERE canvas_projects.user_id = $2`,
		p.ID, uid, p.Title, []byte(p.Data))
	if err != nil {
		httpx.Internal(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// Replace 用整批项目覆盖当前用户的项目集（对应前端 replaceProjects）。
func (h *Handler) Replace(c *gin.Context) {
	uid := middleware.UserIDFrom(c)
	var body struct {
		Projects []projectPayload `json:"projects"`
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
	if _, err := tx.Exec(c.Request.Context(), `DELETE FROM canvas_projects WHERE user_id = $1`, uid); err != nil {
		httpx.Internal(c, err)
		return
	}
	for _, p := range body.Projects {
		if p.ID == "" || len(p.Data) == 0 {
			continue
		}
		if _, err := tx.Exec(c.Request.Context(),
			`INSERT INTO canvas_projects (id, user_id, title, data) VALUES ($1, $2, $3, $4)`,
			p.ID, uid, p.Title, []byte(p.Data)); err != nil {
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

// Delete 删除单个项目。
func (h *Handler) Delete(c *gin.Context) {
	uid := middleware.UserIDFrom(c)
	id := c.Param("id")
	tag, err := h.pool.Exec(c.Request.Context(),
		`DELETE FROM canvas_projects WHERE id = $1 AND user_id = $2`, id, uid)
	if err != nil {
		httpx.Internal(c, err)
		return
	}
	if tag.RowsAffected() == 0 {
		httpx.NotFound(c, "project not found")
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}
