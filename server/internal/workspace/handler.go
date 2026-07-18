// Package workspace 提供任务中心、画布版本/分享、工作流模板、通知和团队空间 API。
package workspace

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/basketikun/infinite-canvas/server/internal/httpx"
	"github.com/basketikun/infinite-canvas/server/internal/middleware"
)

type Handler struct{ pool *pgxpool.Pool }

func NewHandler(pool *pgxpool.Pool) *Handler { return &Handler{pool: pool} }

type Task struct {
	ID          string          `json:"id"`
	ClientKey   string          `json:"clientKey"`
	Capability  string          `json:"capability"`
	Status      string          `json:"status"`
	Title       string          `json:"title"`
	Prompt      string          `json:"prompt"`
	Model       string          `json:"model"`
	Request     json.RawMessage `json:"request,omitempty"`
	Result      json.RawMessage `json:"result,omitempty"`
	Error       string          `json:"error,omitempty"`
	CreatedAt   string          `json:"createdAt"`
	UpdatedAt   string          `json:"updatedAt"`
	CompletedAt string          `json:"completedAt,omitempty"`
}

type taskUpdate struct {
	ClientKey  string          `json:"clientKey"`
	Capability string          `json:"capability"`
	Status     string          `json:"status"`
	Title      string          `json:"title"`
	Prompt     string          `json:"prompt"`
	Model      string          `json:"model"`
	Request    json.RawMessage `json:"request"`
	Result     json.RawMessage `json:"result"`
	Error      string          `json:"error"`
}

func (h *Handler) ListTasks(c *gin.Context) {
	uid := middleware.UserIDFrom(c)
	status := strings.TrimSpace(c.Query("status"))
	capability := strings.TrimSpace(c.Query("capability"))
	query := strings.TrimSpace(c.Query("q"))
	rows, err := h.pool.Query(c.Request.Context(),
		`SELECT id, client_key, capability, status, title, prompt, model, request, result,
		        error_message, created_at, updated_at, completed_at
		 FROM generation_logs
		 WHERE user_id = $1
		   AND ($2 = '' OR status = $2)
		   AND ($3 = '' OR capability = $3)
		   AND ($4 = '' OR title ILIKE '%' || $4 || '%' OR prompt ILIKE '%' || $4 || '%' OR model ILIKE '%' || $4 || '%')
		 ORDER BY created_at DESC LIMIT 200`, uid, status, capability, query)
	if err != nil {
		httpx.Internal(c, err)
		return
	}
	defer rows.Close()
	items := make([]Task, 0)
	for rows.Next() {
		item, scanErr := scanTask(rows)
		if scanErr != nil {
			httpx.Internal(c, scanErr)
			return
		}
		items = append(items, item)
	}
	c.JSON(http.StatusOK, gin.H{"items": items})
}

func (h *Handler) UpsertTask(c *gin.Context) {
	uid := middleware.UserIDFrom(c)
	var input taskUpdate
	if err := c.ShouldBindJSON(&input); err != nil || strings.TrimSpace(input.ClientKey) == "" {
		httpx.BadRequest(c, "clientKey is required")
		return
	}
	input.Capability = normalizeCapability(input.Capability)
	input.Status = normalizeStatus(input.Status)
	if input.Capability == "" || input.Status == "" {
		httpx.BadRequest(c, "invalid task capability or status")
		return
	}
	if len(input.Request) == 0 {
		input.Request = json.RawMessage(`{}`)
	}
	if len(input.Result) == 0 {
		input.Result = json.RawMessage(`{}`)
	}
	completedAt := any(nil)
	if input.Status == "done" || input.Status == "failed" {
		completedAt = time.Now()
	}
	var id string
	err := h.pool.QueryRow(c.Request.Context(),
		`INSERT INTO generation_logs (user_id, client_key, capability, status, title, prompt, model, request, result, error_message, updated_at, completed_at)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now(), $11)
		 ON CONFLICT (user_id, client_key) WHERE client_key <> '' DO UPDATE SET
		   capability = EXCLUDED.capability, status = EXCLUDED.status, title = EXCLUDED.title,
		   prompt = EXCLUDED.prompt, model = EXCLUDED.model, request = EXCLUDED.request,
		   result = EXCLUDED.result, error_message = EXCLUDED.error_message,
		   updated_at = now(), completed_at = EXCLUDED.completed_at
		 RETURNING id::text`, uid, input.ClientKey, input.Capability, input.Status,
		strings.TrimSpace(input.Title), strings.TrimSpace(input.Prompt), strings.TrimSpace(input.Model),
		[]byte(input.Request), []byte(input.Result), strings.TrimSpace(input.Error), completedAt).Scan(&id)
	if err != nil {
		httpx.Internal(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"id": id, "clientKey": input.ClientKey})
}

func (h *Handler) DeleteTask(c *gin.Context) {
	tag, err := h.pool.Exec(c.Request.Context(), `DELETE FROM generation_logs WHERE id = $1 AND user_id = $2`, c.Param("id"), middleware.UserIDFrom(c))
	if err != nil {
		httpx.Internal(c, err)
		return
	}
	if tag.RowsAffected() == 0 {
		httpx.NotFound(c, "task not found")
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

type versionInput struct {
	Label    string          `json:"label"`
	Snapshot json.RawMessage `json:"snapshot"`
}

type CanvasVersion struct {
	ID        string          `json:"id"`
	ProjectID string          `json:"projectId"`
	Label     string          `json:"label"`
	Snapshot  json.RawMessage `json:"snapshot"`
	CreatedAt string          `json:"createdAt"`
}

func (h *Handler) ListVersions(c *gin.Context) {
	if !h.canViewProject(c, c.Param("id")) {
		return
	}
	rows, err := h.pool.Query(c.Request.Context(), `SELECT id::text, project_id, label, snapshot, created_at FROM canvas_versions WHERE project_id = $1 ORDER BY created_at DESC LIMIT 100`, c.Param("id"))
	if err != nil {
		httpx.Internal(c, err)
		return
	}
	defer rows.Close()
	items := make([]CanvasVersion, 0)
	for rows.Next() {
		var item CanvasVersion
		var snapshot []byte
		var created time.Time
		if err := rows.Scan(&item.ID, &item.ProjectID, &item.Label, &snapshot, &created); err != nil {
			httpx.Internal(c, err)
			return
		}
		item.Snapshot, item.CreatedAt = json.RawMessage(snapshot), created.Format(time.RFC3339)
		items = append(items, item)
	}
	c.JSON(http.StatusOK, gin.H{"items": items})
}

func (h *Handler) CreateVersion(c *gin.Context) {
	if !h.canEditProject(c, c.Param("id")) {
		return
	}
	var input versionInput
	if err := c.ShouldBindJSON(&input); err != nil {
		httpx.BadRequest(c, "invalid version")
		return
	}
	if len(input.Snapshot) == 0 {
		if err := h.pool.QueryRow(c.Request.Context(), `SELECT data FROM canvas_projects WHERE id = $1`, c.Param("id")).Scan(&input.Snapshot); err != nil {
			httpx.Internal(c, err)
			return
		}
	}
	var id string
	err := h.pool.QueryRow(c.Request.Context(), `INSERT INTO canvas_versions (project_id, user_id, label, snapshot) VALUES ($1, $2, $3, $4) RETURNING id::text`, c.Param("id"), middleware.UserIDFrom(c), strings.TrimSpace(input.Label), []byte(input.Snapshot)).Scan(&id)
	if err != nil {
		httpx.Internal(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"id": id})
}

func (h *Handler) RestoreVersion(c *gin.Context) {
	if !h.canEditProject(c, c.Param("id")) {
		return
	}
	var snapshot []byte
	if err := h.pool.QueryRow(c.Request.Context(), `SELECT snapshot FROM canvas_versions WHERE id = $1 AND project_id = $2`, c.Param("versionId"), c.Param("id")).Scan(&snapshot); errors.Is(err, pgx.ErrNoRows) {
		httpx.NotFound(c, "version not found")
		return
	} else if err != nil {
		httpx.Internal(c, err)
		return
	}
	if _, err := h.pool.Exec(c.Request.Context(), `UPDATE canvas_projects SET data = $1, updated_at = now() WHERE id = $2`, snapshot, c.Param("id")); err != nil {
		httpx.Internal(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"project": json.RawMessage(snapshot)})
}

type shareInput struct {
	Permission string     `json:"permission"`
	ExpiresAt  *time.Time `json:"expiresAt"`
}

type Share struct {
	ID         string     `json:"id"`
	ProjectID  string     `json:"projectId"`
	Token      string     `json:"token"`
	Permission string     `json:"permission"`
	ExpiresAt  *time.Time `json:"expiresAt,omitempty"`
	CreatedAt  string     `json:"createdAt"`
}

func (h *Handler) ListShares(c *gin.Context) {
	if !h.isProjectOwner(c, c.Param("id")) {
		return
	}
	rows, err := h.pool.Query(c.Request.Context(), `SELECT id::text, project_id, token, permission, expires_at, created_at FROM canvas_shares WHERE project_id = $1 ORDER BY created_at DESC`, c.Param("id"))
	if err != nil {
		httpx.Internal(c, err)
		return
	}
	defer rows.Close()
	items := make([]Share, 0)
	for rows.Next() {
		var item Share
		var expires *time.Time
		var created time.Time
		if err := rows.Scan(&item.ID, &item.ProjectID, &item.Token, &item.Permission, &expires, &created); err != nil {
			httpx.Internal(c, err)
			return
		}
		item.ExpiresAt, item.CreatedAt = expires, created.Format(time.RFC3339)
		items = append(items, item)
	}
	c.JSON(http.StatusOK, gin.H{"items": items})
}

func (h *Handler) CreateShare(c *gin.Context) {
	if !h.canEditProject(c, c.Param("id")) {
		return
	}
	var input shareInput
	if err := c.ShouldBindJSON(&input); err != nil {
		httpx.BadRequest(c, "invalid share")
		return
	}
	if input.Permission != "copy" {
		input.Permission = "view"
	}
	token, err := secureToken()
	if err != nil {
		httpx.Internal(c, err)
		return
	}
	var share Share
	var created time.Time
	err = h.pool.QueryRow(c.Request.Context(), `INSERT INTO canvas_shares (project_id, owner_id, token, permission, expires_at) VALUES ($1, $2, $3, $4, $5) RETURNING id::text, project_id, token, permission, expires_at, created_at`, c.Param("id"), middleware.UserIDFrom(c), token, input.Permission, input.ExpiresAt).Scan(&share.ID, &share.ProjectID, &share.Token, &share.Permission, &share.ExpiresAt, &created)
	if err != nil {
		httpx.Internal(c, err)
		return
	}
	share.CreatedAt = created.Format(time.RFC3339)
	c.JSON(http.StatusCreated, share)
}

func (h *Handler) DeleteShare(c *gin.Context) {
	if !h.isProjectOwner(c, c.Param("id")) {
		return
	}
	tag, err := h.pool.Exec(c.Request.Context(), `DELETE FROM canvas_shares WHERE id = $1 AND project_id = $2`, c.Param("shareId"), c.Param("id"))
	if err != nil {
		httpx.Internal(c, err)
		return
	}
	if tag.RowsAffected() == 0 {
		httpx.NotFound(c, "share not found")
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (h *Handler) GetShared(c *gin.Context) {
	var projectID, title, permission string
	var data []byte
	var expires *time.Time
	err := h.pool.QueryRow(c.Request.Context(), `SELECT s.project_id, p.title, p.data, s.permission, s.expires_at FROM canvas_shares s JOIN canvas_projects p ON p.id = s.project_id WHERE s.token = $1 AND (s.expires_at IS NULL OR s.expires_at > now())`, c.Param("token")).Scan(&projectID, &title, &data, &permission, &expires)
	if errors.Is(err, pgx.ErrNoRows) {
		httpx.NotFound(c, "share not found or expired")
		return
	}
	if err != nil {
		httpx.Internal(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"projectId": projectID, "title": title, "permission": permission, "expiresAt": expires, "project": json.RawMessage(data)})
}

func (h *Handler) CopyShared(c *gin.Context) {
	var title string
	var data []byte
	var permission string
	err := h.pool.QueryRow(c.Request.Context(), `SELECT p.title, p.data, s.permission FROM canvas_shares s JOIN canvas_projects p ON p.id = s.project_id WHERE s.token = $1 AND (s.expires_at IS NULL OR s.expires_at > now())`, c.Param("token")).Scan(&title, &data, &permission)
	if errors.Is(err, pgx.ErrNoRows) {
		httpx.NotFound(c, "share not found or expired")
		return
	}
	if err != nil {
		httpx.Internal(c, err)
		return
	}
	if permission != "copy" {
		httpx.Forbidden(c, "copy is not allowed")
		return
	}
	var projectID string
	err = h.pool.QueryRow(c.Request.Context(), `INSERT INTO canvas_projects (id, user_id, title, data) VALUES (gen_random_uuid()::text, $1, $2, $3) RETURNING id`, middleware.UserIDFrom(c), strings.TrimSpace(title)+"（副本）", data).Scan(&projectID)
	if err != nil {
		httpx.Internal(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"projectId": projectID, "title": strings.TrimSpace(title) + "（副本）", "project": json.RawMessage(data)})
}

type Template struct {
	ID          string          `json:"id"`
	OwnerID     string          `json:"ownerId"`
	Name        string          `json:"name"`
	Description string          `json:"description"`
	Tags        []string        `json:"tags"`
	Visibility  string          `json:"visibility"`
	Data        json.RawMessage `json:"data"`
	Uses        int64           `json:"uses"`
	CreatedAt   string          `json:"createdAt"`
	UpdatedAt   string          `json:"updatedAt"`
}

type templateInput struct {
	Name        string          `json:"name"`
	Description string          `json:"description"`
	Tags        []string        `json:"tags"`
	Visibility  string          `json:"visibility"`
	Data        json.RawMessage `json:"data"`
}

func (h *Handler) ListTemplates(c *gin.Context) {
	uid := middleware.UserIDFrom(c)
	q := strings.TrimSpace(c.Query("q"))
	rows, err := h.pool.Query(c.Request.Context(), `SELECT id::text, owner_id::text, name, description, tags, visibility, data, uses, created_at, updated_at FROM workflow_templates WHERE (owner_id = $1 OR visibility = 'public') AND ($2 = '' OR name ILIKE '%' || $2 || '%' OR description ILIKE '%' || $2 || '%') ORDER BY updated_at DESC LIMIT 100`, uid, q)
	if err != nil {
		httpx.Internal(c, err)
		return
	}
	defer rows.Close()
	items := make([]Template, 0)
	for rows.Next() {
		item, scanErr := scanTemplate(rows)
		if scanErr != nil {
			httpx.Internal(c, scanErr)
			return
		}
		items = append(items, item)
	}
	c.JSON(http.StatusOK, gin.H{"items": items})
}

func (h *Handler) CreateTemplate(c *gin.Context) {
	var input templateInput
	if err := c.ShouldBindJSON(&input); err != nil || strings.TrimSpace(input.Name) == "" || len(input.Data) == 0 {
		httpx.BadRequest(c, "name and data are required")
		return
	}
	if input.Visibility != "public" {
		input.Visibility = "private"
	}
	var id string
	err := h.pool.QueryRow(c.Request.Context(), `INSERT INTO workflow_templates (owner_id, name, description, tags, visibility, data) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id::text`, middleware.UserIDFrom(c), strings.TrimSpace(input.Name), strings.TrimSpace(input.Description), input.Tags, input.Visibility, []byte(input.Data)).Scan(&id)
	if err != nil {
		httpx.Internal(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"id": id})
}

func (h *Handler) UseTemplate(c *gin.Context) {
	var data []byte
	var visibility, ownerID string
	err := h.pool.QueryRow(c.Request.Context(), `SELECT data, visibility, owner_id::text FROM workflow_templates WHERE id = $1`, c.Param("id")).Scan(&data, &visibility, &ownerID)
	if errors.Is(err, pgx.ErrNoRows) {
		httpx.NotFound(c, "template not found")
		return
	}
	if err != nil {
		httpx.Internal(c, err)
		return
	}
	if visibility != "public" && ownerID != middleware.UserIDFrom(c) {
		httpx.Forbidden(c, "template is private")
		return
	}
	if _, err := h.pool.Exec(c.Request.Context(), `UPDATE workflow_templates SET uses = uses + 1, updated_at = now() WHERE id = $1`, c.Param("id")); err != nil {
		httpx.Internal(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": json.RawMessage(data)})
}

func (h *Handler) DeleteTemplate(c *gin.Context) {
	tag, err := h.pool.Exec(c.Request.Context(), `DELETE FROM workflow_templates WHERE id = $1 AND owner_id = $2`, c.Param("id"), middleware.UserIDFrom(c))
	if err != nil {
		httpx.Internal(c, err)
		return
	}
	if tag.RowsAffected() == 0 {
		httpx.NotFound(c, "template not found")
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

type Notification struct {
	ID        string          `json:"id"`
	Type      string          `json:"type"`
	Title     string          `json:"title"`
	Body      string          `json:"body"`
	Data      json.RawMessage `json:"data"`
	Read      bool            `json:"read"`
	CreatedAt string          `json:"createdAt"`
}

func (h *Handler) ListNotifications(c *gin.Context) {
	rows, err := h.pool.Query(c.Request.Context(), `SELECT id::text, type, title, body, data, read_at IS NOT NULL, created_at FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 100`, middleware.UserIDFrom(c))
	if err != nil {
		httpx.Internal(c, err)
		return
	}
	defer rows.Close()
	items := make([]Notification, 0)
	unread := 0
	for rows.Next() {
		var item Notification
		var data []byte
		var created time.Time
		if err := rows.Scan(&item.ID, &item.Type, &item.Title, &item.Body, &data, &item.Read, &created); err != nil {
			httpx.Internal(c, err)
			return
		}
		item.Data, item.CreatedAt = json.RawMessage(data), created.Format(time.RFC3339)
		if !item.Read {
			unread++
		}
		items = append(items, item)
	}
	c.JSON(http.StatusOK, gin.H{"items": items, "unread": unread})
}

func (h *Handler) MarkNotificationRead(c *gin.Context) {
	if _, err := h.pool.Exec(c.Request.Context(), `UPDATE notifications SET read_at = COALESCE(read_at, now()) WHERE id = $1 AND user_id = $2`, c.Param("id"), middleware.UserIDFrom(c)); err != nil {
		httpx.Internal(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (h *Handler) MarkAllNotificationsRead(c *gin.Context) {
	if _, err := h.pool.Exec(c.Request.Context(), `UPDATE notifications SET read_at = COALESCE(read_at, now()) WHERE user_id = $1 AND read_at IS NULL`, middleware.UserIDFrom(c)); err != nil {
		httpx.Internal(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

type Team struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Role      string `json:"role"`
	Members   int    `json:"members"`
	CreatedAt string `json:"createdAt"`
	UpdatedAt string `json:"updatedAt"`
}

type createTeamInput struct {
	Name string `json:"name"`
}
type teamMemberInput struct {
	Email string `json:"email"`
	Role  string `json:"role"`
}

func (h *Handler) ListTeams(c *gin.Context) {
	rows, err := h.pool.Query(c.Request.Context(), `SELECT t.id::text, t.name, tm.role, count(m.user_id), t.created_at, t.updated_at FROM teams t JOIN team_members tm ON tm.team_id = t.id LEFT JOIN team_members m ON m.team_id = t.id WHERE tm.user_id = $1 GROUP BY t.id, t.name, tm.role, t.created_at, t.updated_at ORDER BY t.updated_at DESC`, middleware.UserIDFrom(c))
	if err != nil {
		httpx.Internal(c, err)
		return
	}
	defer rows.Close()
	items := make([]Team, 0)
	for rows.Next() {
		var item Team
		var created, updated time.Time
		if err := rows.Scan(&item.ID, &item.Name, &item.Role, &item.Members, &created, &updated); err != nil {
			httpx.Internal(c, err)
			return
		}
		item.CreatedAt, item.UpdatedAt = created.Format(time.RFC3339), updated.Format(time.RFC3339)
		items = append(items, item)
	}
	c.JSON(http.StatusOK, gin.H{"items": items})
}

func (h *Handler) CreateTeam(c *gin.Context) {
	var input createTeamInput
	if err := c.ShouldBindJSON(&input); err != nil || strings.TrimSpace(input.Name) == "" {
		httpx.BadRequest(c, "team name is required")
		return
	}
	ctx := c.Request.Context()
	tx, err := h.pool.Begin(ctx)
	if err != nil {
		httpx.Internal(c, err)
		return
	}
	defer tx.Rollback(ctx)
	var id string
	if err := tx.QueryRow(ctx, `INSERT INTO teams (owner_id, name) VALUES ($1, $2) RETURNING id::text`, middleware.UserIDFrom(c), strings.TrimSpace(input.Name)).Scan(&id); err != nil {
		httpx.Internal(c, err)
		return
	}
	if _, err := tx.Exec(ctx, `INSERT INTO team_members (team_id, user_id, role) VALUES ($1, $2, 'owner')`, id, middleware.UserIDFrom(c)); err != nil {
		httpx.Internal(c, err)
		return
	}
	if err := tx.Commit(ctx); err != nil {
		httpx.Internal(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"id": id})
}

func (h *Handler) AddTeamMember(c *gin.Context) {
	teamID := c.Param("id")
	if !h.isTeamOwner(c, teamID) {
		return
	}
	var input teamMemberInput
	if err := c.ShouldBindJSON(&input); err != nil || strings.TrimSpace(input.Email) == "" {
		httpx.BadRequest(c, "email is required")
		return
	}
	role := input.Role
	if role != "viewer" {
		role = "editor"
	}
	var userID, displayName string
	err := h.pool.QueryRow(c.Request.Context(), `SELECT id::text, display_name FROM users WHERE lower(email) = lower($1)`, strings.TrimSpace(input.Email)).Scan(&userID, &displayName)
	if errors.Is(err, pgx.ErrNoRows) {
		httpx.NotFound(c, "user not found; invite them to register first")
		return
	}
	if err != nil {
		httpx.Internal(c, err)
		return
	}
	if _, err := h.pool.Exec(c.Request.Context(), `INSERT INTO team_members (team_id, user_id, role) VALUES ($1, $2, $3) ON CONFLICT (team_id, user_id) DO UPDATE SET role = EXCLUDED.role`, teamID, userID, role); err != nil {
		httpx.Internal(c, err)
		return
	}
	_, _ = h.pool.Exec(c.Request.Context(), `INSERT INTO notifications (user_id, type, title, body, data) VALUES ($1, 'team', '你已加入团队空间', $2, jsonb_build_object('teamId', $3))`, userID, "你已被添加到团队空间。", teamID)
	c.JSON(http.StatusOK, gin.H{"ok": true, "userId": userID, "displayName": displayName, "role": role})
}

func (h *Handler) ListTeamMembers(c *gin.Context) {
	if !h.isTeamMember(c, c.Param("id")) {
		return
	}
	rows, err := h.pool.Query(c.Request.Context(), `SELECT u.id::text, u.email, u.display_name, tm.role, tm.created_at FROM team_members tm JOIN users u ON u.id = tm.user_id WHERE tm.team_id = $1 ORDER BY tm.role = 'owner' DESC, tm.created_at`, c.Param("id"))
	if err != nil {
		httpx.Internal(c, err)
		return
	}
	defer rows.Close()
	items := make([]gin.H, 0)
	for rows.Next() {
		var id, email, name, role string
		var created time.Time
		if err := rows.Scan(&id, &email, &name, &role, &created); err != nil {
			httpx.Internal(c, err)
			return
		}
		items = append(items, gin.H{"id": id, "email": email, "displayName": name, "role": role, "createdAt": created.Format(time.RFC3339)})
	}
	c.JSON(http.StatusOK, gin.H{"items": items})
}

func (h *Handler) RemoveTeamMember(c *gin.Context) {
	if !h.isTeamOwner(c, c.Param("id")) {
		return
	}
	if c.Param("userId") == middleware.UserIDFrom(c) {
		httpx.BadRequest(c, "team owner cannot remove themselves")
		return
	}
	if _, err := h.pool.Exec(c.Request.Context(), `DELETE FROM team_members WHERE team_id = $1 AND user_id = $2 AND role <> 'owner'`, c.Param("id"), c.Param("userId")); err != nil {
		httpx.Internal(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (h *Handler) SetProjectTeam(c *gin.Context) {
	if !h.isProjectOwner(c, c.Param("id")) {
		return
	}
	var input struct {
		TeamID *string `json:"teamId"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		httpx.BadRequest(c, "invalid team")
		return
	}
	if input.TeamID != nil && *input.TeamID != "" && !h.isTeamOwner(c, *input.TeamID) {
		httpx.Forbidden(c, "only team owner can attach a team")
		return
	}
	var team any
	if input.TeamID != nil && *input.TeamID != "" {
		team = *input.TeamID
	}
	if _, err := h.pool.Exec(c.Request.Context(), `UPDATE canvas_projects SET team_id = $1, updated_at = now() WHERE id = $2`, team, c.Param("id")); err != nil {
		httpx.Internal(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (h *Handler) canViewProject(c *gin.Context, projectID string) bool {
	role, err := h.projectRole(c.Request.Context(), middleware.UserIDFrom(c), projectID)
	if err != nil {
		httpx.Internal(c, err)
		return false
	}
	if role == "" {
		httpx.Forbidden(c, "project access denied")
		return false
	}
	return true
}

func (h *Handler) canEditProject(c *gin.Context, projectID string) bool {
	role, err := h.projectRole(c.Request.Context(), middleware.UserIDFrom(c), projectID)
	if err != nil {
		httpx.Internal(c, err)
		return false
	}
	if role != "owner" && role != "editor" {
		httpx.Forbidden(c, "project is read-only")
		return false
	}
	return true
}

func (h *Handler) projectRole(ctx context.Context, uid, projectID string) (string, error) {
	var role string
	err := h.pool.QueryRow(ctx, `SELECT CASE WHEN p.user_id::text = $1 THEN 'owner' ELSE COALESCE((SELECT tm.role FROM team_members tm WHERE tm.team_id = p.team_id AND tm.user_id::text = $1), '') END FROM canvas_projects p WHERE p.id = $2`, uid, projectID).Scan(&role)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", nil
	}
	return role, err
}

func (h *Handler) isProjectOwner(c *gin.Context, projectID string) bool {
	var ok bool
	err := h.pool.QueryRow(c.Request.Context(), `SELECT EXISTS(SELECT 1 FROM canvas_projects WHERE id = $1 AND user_id = $2)`, projectID, middleware.UserIDFrom(c)).Scan(&ok)
	if err != nil {
		httpx.Internal(c, err)
		return false
	}
	if !ok {
		httpx.Forbidden(c, "project owner required")
	}
	return ok
}

func (h *Handler) isTeamMember(c *gin.Context, teamID string) bool {
	var ok bool
	err := h.pool.QueryRow(c.Request.Context(), `SELECT EXISTS(SELECT 1 FROM team_members WHERE team_id = $1 AND user_id = $2)`, teamID, middleware.UserIDFrom(c)).Scan(&ok)
	if err != nil {
		httpx.Internal(c, err)
		return false
	}
	if !ok {
		httpx.Forbidden(c, "team access denied")
	}
	return ok
}

func (h *Handler) isTeamOwner(c *gin.Context, teamID string) bool {
	var ok bool
	err := h.pool.QueryRow(c.Request.Context(), `SELECT EXISTS(SELECT 1 FROM teams WHERE id = $1 AND owner_id = $2)`, teamID, middleware.UserIDFrom(c)).Scan(&ok)
	if err != nil {
		httpx.Internal(c, err)
		return false
	}
	if !ok {
		httpx.Forbidden(c, "team owner required")
	}
	return ok
}

func scanTask(row interface{ Scan(...any) error }) (Task, error) {
	var item Task
	var request, result []byte
	var created, updated time.Time
	var completed *time.Time
	err := row.Scan(&item.ID, &item.ClientKey, &item.Capability, &item.Status, &item.Title, &item.Prompt, &item.Model, &request, &result, &item.Error, &created, &updated, &completed)
	item.Request, item.Result = json.RawMessage(request), json.RawMessage(result)
	item.CreatedAt, item.UpdatedAt = created.Format(time.RFC3339), updated.Format(time.RFC3339)
	if completed != nil {
		item.CompletedAt = completed.Format(time.RFC3339)
	}
	return item, err
}

func scanTemplate(row interface{ Scan(...any) error }) (Template, error) {
	var item Template
	var data []byte
	var created, updated time.Time
	err := row.Scan(&item.ID, &item.OwnerID, &item.Name, &item.Description, &item.Tags, &item.Visibility, &data, &item.Uses, &created, &updated)
	item.Data, item.CreatedAt, item.UpdatedAt = json.RawMessage(data), created.Format(time.RFC3339), updated.Format(time.RFC3339)
	return item, err
}

func normalizeCapability(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	switch value {
	case "image", "video", "text", "audio":
		return value
	default:
		return ""
	}
}

func normalizeStatus(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	if value == "completed" {
		value = "done"
	}
	switch value {
	case "pending", "running", "done", "failed":
		return value
	default:
		return ""
	}
}

func secureToken() (string, error) {
	buf := make([]byte, 24)
	if _, err := rand.Read(buf); err != nil {
		return "", fmt.Errorf("generate share token: %w", err)
	}
	return base64.RawURLEncoding.EncodeToString(buf), nil
}
