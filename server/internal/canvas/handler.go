// Package canvas 提供画布项目的按用户隔离 CRUD，整个前端 CanvasProject 存 JSONB。
package canvas

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgconn"
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
		`SELECT data,
			CASE WHEN p.user_id = $1 THEN 'owner'
			     ELSE COALESCE((SELECT tm.role FROM team_members tm WHERE tm.team_id = p.team_id AND tm.user_id = $1), 'viewer')
			END AS access_role
		 FROM canvas_projects p
		 WHERE p.user_id = $1
		    OR EXISTS (SELECT 1 FROM team_members tm WHERE tm.team_id = p.team_id AND tm.user_id = $1)
		 ORDER BY updated_at DESC`, uid)
	if err != nil {
		httpx.Internal(c, err)
		return
	}
	defer rows.Close()
	out := []json.RawMessage{}
	for rows.Next() {
		var data []byte
		var accessRole string
		if err := rows.Scan(&data, &accessRole); err != nil {
			httpx.Internal(c, err)
			return
		}
		var project map[string]any
		if err := json.Unmarshal(data, &project); err != nil {
			httpx.Internal(c, err)
			return
		}
		project["accessRole"] = accessRole
		enriched, err := json.Marshal(project)
		if err != nil {
			httpx.Internal(c, err)
			return
		}
		out = append(out, json.RawMessage(enriched))
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
	result, err := h.pool.Exec(c.Request.Context(),
		`INSERT INTO canvas_projects (id, user_id, title, data, updated_at)
		 VALUES ($1, $2, $3, $4, now())
		 ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, data = EXCLUDED.data, updated_at = now()
		 WHERE canvas_projects.user_id = $2 OR EXISTS (
		   SELECT 1 FROM team_members tm
		   WHERE tm.team_id = canvas_projects.team_id AND tm.user_id = $2 AND tm.role IN ('owner', 'editor')
		 )`,
		p.ID, uid, p.Title, []byte(p.Data))
	if err != nil {
		httpx.Internal(c, err)
		return
	}
	if result.RowsAffected() == 0 {
		httpx.Forbidden(c, "project is read-only or not found")
		return
	}
	if err := h.syncProjectFileGrants(c, p.ID, p.Data); err != nil {
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
	for _, p := range body.Projects {
		if p.ID == "" || len(p.Data) == 0 {
			continue
		}
		result, err := tx.Exec(c.Request.Context(),
			`INSERT INTO canvas_projects (id, user_id, title, data) VALUES ($1, $2, $3, $4)
			 ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, data = EXCLUDED.data, updated_at = now()
			 WHERE canvas_projects.user_id = $2 OR EXISTS (
			   SELECT 1 FROM team_members tm
			   WHERE tm.team_id = canvas_projects.team_id AND tm.user_id = $2 AND tm.role IN ('owner', 'editor')
			 )`,
			p.ID, uid, p.Title, []byte(p.Data))
		if err != nil {
			httpx.Internal(c, err)
			return
		}
		if result.RowsAffected() == 0 {
			continue
		}
		if err := h.syncProjectFileGrantsTx(c, tx, p.ID, p.Data); err != nil {
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

func (h *Handler) syncProjectFileGrants(c *gin.Context, projectID string, data []byte) error {
	return h.syncProjectFileGrantsTx(c, h.pool, projectID, data)
}

type execer interface {
	Exec(context.Context, string, ...any) (pgconn.CommandTag, error)
}

func (h *Handler) syncProjectFileGrantsTx(c *gin.Context, exec execer, projectID string, data []byte) error {
	keys := collectStorageKeys(data)
	if _, err := exec.Exec(c.Request.Context(), `DELETE FROM file_access_grants WHERE project_id = $1`, projectID); err != nil {
		return err
	}
	if len(keys) == 0 {
		return nil
	}
	_, err := exec.Exec(c.Request.Context(),
		`INSERT INTO file_access_grants (storage_key, grantee_user_id, project_id)
		 SELECT DISTINCT f.storage_key, tm.user_id, p.id
		 FROM canvas_projects p
		 JOIN team_members tm ON tm.team_id = p.team_id
		 JOIN files f ON f.storage_key = ANY($2::text[]) AND f.deleted_at IS NULL
		 WHERE p.id = $1
		 ON CONFLICT DO NOTHING`, projectID, keys)
	return err
}

func collectStorageKeys(data []byte) []string {
	var root any
	if err := json.Unmarshal(data, &root); err != nil {
		return nil
	}
	seen := make(map[string]struct{})
	var walk func(any)
	walk = func(value any) {
		switch item := value.(type) {
		case string:
			if strings.Contains(item, ":") {
				for _, prefix := range []string{"image:", "video:", "audio:", "file:"} {
					if strings.HasPrefix(item, prefix) {
						seen[item] = struct{}{}
						break
					}
				}
			}
		case []any:
			for _, child := range item {
				walk(child)
			}
		case map[string]any:
			for _, child := range item {
				walk(child)
			}
		}
	}
	walk(root)
	keys := make([]string, 0, len(seen))
	for key := range seen {
		keys = append(keys, key)
	}
	return keys
}
