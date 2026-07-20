package admin

import (
	"errors"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5"

	"github.com/basketikun/infinite-canvas/server/internal/auth"
	"github.com/basketikun/infinite-canvas/server/internal/httpx"
)

// mediaItem 是 admin 预览的一条用户媒体：storageKey 用于经 /admin/users/:id/media/:key
// 拉取二进制预览，kind 由 storageKey 前缀（image:/video:/...）推断。
type mediaItem struct {
	StorageKey string `json:"storageKey"`
	Kind       string `json:"kind"`
	MimeType   string `json:"mimeType"`
	Bytes      int64  `json:"bytes"`
	CreatedAt  string `json:"createdAt"`
}

// UserMedia 列出指定用户上传/生成的媒体文件（图片、视频等），供 admin 预览。
func (h *Handler) UserMedia(c *gin.Context) {
	id := c.Param("id")
	if _, err := h.users.FindByID(c.Request.Context(), id); err != nil {
		if errors.Is(err, auth.ErrNotFound) {
			httpx.NotFound(c, "user not found")
			return
		}
		httpx.Internal(c, err)
		return
	}
	rows, err := h.pool.Query(c.Request.Context(),
		`SELECT storage_key, mime_type, bytes, created_at
		 FROM files WHERE user_id = $1 ORDER BY created_at DESC LIMIT 500`, id)
	if err != nil {
		httpx.Internal(c, err)
		return
	}
	defer rows.Close()
	items := []mediaItem{}
	for rows.Next() {
		var m mediaItem
		var created time.Time
		if err := rows.Scan(&m.StorageKey, &m.MimeType, &m.Bytes, &created); err != nil {
			httpx.Internal(c, err)
			return
		}
		m.Kind = kindFromStorageKey(m.StorageKey)
		m.CreatedAt = created.Format(time.RFC3339)
		items = append(items, m)
	}
	c.JSON(http.StatusOK, gin.H{"items": items})
}

// MediaPreview 按 storageKey 回传某用户的媒体二进制，供 admin 在后台直接预览图片/视频。
// 与用户侧 /files/:key 的区别：这里按路径中的用户 id 取，不限制归属当前管理员。
func (h *Handler) MediaPreview(c *gin.Context) {
	if h.store == nil || !h.store.Available() {
		httpx.Fail(c, http.StatusServiceUnavailable, "对象存储未启用或连接不可用")
		return
	}
	id := c.Param("id")
	storageKey := c.Param("key")
	var objectKey, mimeType string
	err := h.pool.QueryRow(c.Request.Context(),
		`SELECT object_key, mime_type FROM files WHERE storage_key = $1 AND user_id = $2`,
		storageKey, id).Scan(&objectKey, &mimeType)
	if errors.Is(err, pgx.ErrNoRows) {
		httpx.NotFound(c, "file not found")
		return
	}
	if err != nil {
		httpx.Internal(c, err)
		return
	}
	data, ct, err := h.store.Get(c.Request.Context(), objectKey)
	if err != nil {
		httpx.Internal(c, err)
		return
	}
	if ct == "" {
		ct = mimeType
	}
	c.Header("Cache-Control", "private, max-age=3600")
	c.Data(http.StatusOK, ct, data)
}

// kindFromStorageKey 从前端语义键前缀推断媒体类型（image:xxx → image）。
func kindFromStorageKey(key string) string {
	for i := 0; i < len(key); i++ {
		if key[i] == ':' {
			return key[:i]
		}
	}
	return "file"
}
