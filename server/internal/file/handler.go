// Package file 处理媒体二进制的上传/下载。
// 前端用语义化 storageKey（如 image:xxxx / video:xxxx）引用媒体；
// 后端把它映射到对象存储中带用户前缀的真实 object_key，并在 files 表登记归属，
// 从而保持前端 storageKey 协议不变的同时实现按用户隔离。
package file

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/basketikun/infinite-canvas/server/internal/httpx"
	"github.com/basketikun/infinite-canvas/server/internal/middleware"
	"github.com/basketikun/infinite-canvas/server/internal/storage"
)

const maxUploadBytes int64 = 200 << 20 // 200 MiB

type Handler struct {
	pool  *pgxpool.Pool
	store *storage.Manager
}

func NewHandler(pool *pgxpool.Pool, store *storage.Manager) *Handler {
	return &Handler{pool: pool, store: store}
}

// ensureStore 在对象存储未启用或当前连接不可用时返回 503 并中断请求。
func (h *Handler) ensureStore(c *gin.Context) bool {
	if h.store == nil || !h.store.Available() {
		httpx.Fail(c, http.StatusServiceUnavailable, "对象存储未启用或连接不可用，请联系管理员检查存储配置")
		return false
	}
	return true
}

// Upload 接收 multipart 文件 + storageKey 字段，直接流式写入对象存储并登记。
// 前端 FormData 固定先传 storageKey 再传 file，因此无需 ParseMultipartForm，
// 大视频不会被 net/http 暂存到服务器磁盘。
// 返回 { storageKey, url, bytes, mimeType }，与前端 UploadedImage/UploadedFile 对齐。
func (h *Handler) Upload(c *gin.Context) {
	if !h.ensureStore(c) {
		return
	}
	uid := middleware.UserIDFrom(c)
	reader, err := c.Request.MultipartReader()
	if err != nil {
		httpx.BadRequest(c, "multipart form required")
		return
	}
	var storageKey string
	for {
		part, nextErr := reader.NextPart()
		if errors.Is(nextErr, io.EOF) {
			break
		}
		if nextErr != nil {
			httpx.BadRequest(c, "invalid multipart body")
			return
		}
		if part.FormName() == "storageKey" {
			value, readErr := io.ReadAll(io.LimitReader(part, 513))
			part.Close()
			if readErr != nil || len(value) > 512 {
				httpx.BadRequest(c, "storageKey too long")
				return
			}
			storageKey = strings.TrimSpace(string(value))
			continue
		}
		if part.FormName() != "file" {
			part.Close()
			continue
		}
		if storageKey == "" {
			part.Close()
			httpx.BadRequest(c, "storageKey must precede file field")
			return
		}
		mimeType := part.Header.Get("Content-Type")
		if mimeType == "" {
			mimeType = "application/octet-stream"
		}
		limited := &countingReader{reader: io.LimitReader(part, maxUploadBytes+1)}
		objectKey, written, uploadErr := h.store.PutReader(c.Request.Context(), storageKind(storageKey), objectKeyFor(uid, storageKey), limited, -1, mimeType)
		part.Close()
		if uploadErr != nil {
			httpx.Internal(c, uploadErr)
			return
		}
		if limited.read > maxUploadBytes || written > maxUploadBytes {
			_ = h.store.Delete(c.Request.Context(), objectKey)
			httpx.Fail(c, http.StatusRequestEntityTooLarge, "file too large")
			return
		}
		h.saveUploaded(c, uid, storageKey, objectKey, mimeType, written)
		return
	}
	httpx.BadRequest(c, "file field required")
}

func (h *Handler) saveUploaded(c *gin.Context, uid, storageKey, objectKey, mimeType string, bytes int64) {
	tag, err := h.pool.Exec(c.Request.Context(),
		`INSERT INTO files (storage_key, user_id, object_key, mime_type, bytes)
		 VALUES ($1, $2, $3, $4, $5)
		 ON CONFLICT (storage_key) DO UPDATE SET object_key = EXCLUDED.object_key, mime_type = EXCLUDED.mime_type,
		 bytes = EXCLUDED.bytes, deleted_at = NULL
		 WHERE files.user_id = $2`,
		storageKey, uid, objectKey, mimeType, bytes)
	if err != nil {
		// 数据库登记失败时尽量回收刚上传的对象，避免产生孤儿文件。
		_ = h.store.Delete(c.Request.Context(), objectKey)
		httpx.Internal(c, err)
		return
	}
	if tag.RowsAffected() == 0 {
		_ = h.store.Delete(c.Request.Context(), objectKey)
		httpx.Fail(c, http.StatusConflict, "storageKey already belongs to another user")
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"storageKey": storageKey,
		"objectKey":  objectKey,
		"url":        h.store.PublicFileURL(storageKey),
		"bytes":      bytes,
		"mimeType":   mimeType,
	})
}

// Download 按 storageKey 返回二进制。原作者可读，分享复制/模板/团队成员通过
// file_access_grants 获得最小范围的读取授权。
func (h *Handler) Download(c *gin.Context) {
	if !h.ensureStore(c) {
		return
	}
	uid := middleware.UserIDFrom(c)
	storageKey := c.Param("key")
	var objectKey, mimeType string
	err := h.pool.QueryRow(c.Request.Context(),
		`SELECT f.object_key, f.mime_type
			 FROM files f
			 WHERE f.storage_key = $1 AND f.deleted_at IS NULL
			   AND (f.user_id = $2 OR EXISTS (
				   SELECT 1 FROM file_access_grants g
				   WHERE g.storage_key = f.storage_key AND g.grantee_user_id = $2
			   ))`,
		storageKey, uid).Scan(&objectKey, &mimeType)
	if errors.Is(err, pgx.ErrNoRows) {
		httpx.NotFound(c, "file not found")
		return
	}
	if err != nil {
		httpx.Internal(c, err)
		return
	}
	reader, info, err := h.store.Open(c.Request.Context(), objectKey)
	if err != nil {
		httpx.Internal(c, err)
		return
	}
	defer reader.Close()
	if info.ContentType == "" {
		info.ContentType = mimeType
	}
	c.Header("Cache-Control", "private, max-age=31536000, immutable")
	c.Header("Content-Type", info.ContentType)
	if info.Size >= 0 {
		c.Header("Content-Length", strconv.FormatInt(info.Size, 10))
	}
	c.Status(http.StatusOK)
	if _, err := io.Copy(c.Writer, reader); err != nil {
		_ = c.Error(fmt.Errorf("stream object: %w", err))
	}
	_, _ = h.pool.Exec(c.Request.Context(), `UPDATE files SET last_accessed_at=now() WHERE storage_key=$1 AND user_id=$2`, storageKey, uid)
}

// Trash 把文件移入回收站；实际 OSS 对象由管理员在保留期后清理。
func (h *Handler) Trash(c *gin.Context) {
	uid := middleware.UserIDFrom(c)
	tag, err := h.pool.Exec(c.Request.Context(),
		`UPDATE files SET deleted_at=now() WHERE storage_key=$1 AND user_id=$2 AND deleted_at IS NULL`,
		c.Param("key"), uid)
	if err != nil {
		httpx.Internal(c, err)
		return
	}
	if tag.RowsAffected() == 0 {
		httpx.NotFound(c, "file not found")
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

type countingReader struct {
	reader io.Reader
	read   int64
}

func (r *countingReader) Read(p []byte) (int, error) {
	n, err := r.reader.Read(p)
	r.read += int64(n)
	return n, err
}

// objectKeyFor 生成带用户前缀的对象 key，storageKey 经 sha256 摊平避免特殊字符。
func objectKeyFor(userID, storageKey string) string {
	sum := sha256.Sum256([]byte(storageKey))
	prefix := "file"
	if i := strings.IndexByte(storageKey, ':'); i > 0 {
		prefix = storageKey[:i]
	}
	return "u/" + userID + "/" + prefix + "/" + hex.EncodeToString(sum[:])
}

func storageKind(storageKey string) string {
	if i := strings.IndexByte(storageKey, ':'); i > 0 {
		return storageKey[:i]
	}
	return "file"
}
