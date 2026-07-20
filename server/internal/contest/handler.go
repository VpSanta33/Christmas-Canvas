// Package contest 提供创作者大赛的视频投稿、作品展墙、配方复用与点赞排名。
package contest

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/basketikun/infinite-canvas/server/internal/httpx"
	"github.com/basketikun/infinite-canvas/server/internal/middleware"
	"github.com/basketikun/infinite-canvas/server/internal/storage"
)

const (
	maxEntriesPerUser = 5
	// maxSnapshotBytes 限制画布快照大小，防止超大 JSON 撑爆存储与内存。
	maxSnapshotBytes = 2 << 20 // 2 MiB
)

// mediaKeyPrefixes 是画布节点里媒体 storageKey 的协议前缀。SnapshotFile 用它
// 从快照中收集「允许被跨用户读取」的 key 集合。
var mediaKeyPrefixes = []string{"image:", "video:", "audio:", "file:"}

type Handler struct {
	pool  *pgxpool.Pool
	store *storage.Manager
}

func NewHandler(pool *pgxpool.Pool, store *storage.Manager) *Handler {
	return &Handler{pool: pool, store: store}
}

type createRequest struct {
	VideoStorageKey string          `json:"videoStorageKey"`
	CoverStorageKey string          `json:"coverStorageKey"`
	Title           string          `json:"title"`
	Description     string          `json:"description"`
	RecipeType      string          `json:"recipeType"`
	RecipeContent   string          `json:"recipeContent"`
	CanvasSnapshot  json.RawMessage `json:"canvasSnapshot"`
}

type Entry struct {
	ID            string `json:"id"`
	Title         string `json:"title"`
	Description   string `json:"description"`
	RecipeType    string `json:"recipeType"`
	RecipePreview string `json:"recipePreview"`
	VideoMimeType string `json:"videoMimeType"`
	AuthorID      string `json:"authorId"`
	AuthorName    string `json:"authorName"`
	Likes         int    `json:"likes"`
	LikedByMe     bool   `json:"likedByMe"`
	FavoritedByMe bool   `json:"favoritedByMe"`
	Mine          bool   `json:"mine"`
	Status        string `json:"status"`
	HasWorkflow   bool   `json:"hasWorkflow"`
	CreatedAt     string `json:"createdAt"`
}

type Detail struct {
	Entry
	RecipeContent  string          `json:"recipeContent"`
	CanvasSnapshot json.RawMessage `json:"canvasSnapshot,omitempty"`
}

func (h *Handler) Create(c *gin.Context) {
	if h.store == nil || !h.store.Available() {
		httpx.Fail(c, http.StatusServiceUnavailable, "对象存储未启用或连接不可用")
		return
	}
	var req createRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		httpx.BadRequest(c, "invalid body")
		return
	}
	normalizeCreateRequest(&req)
	if msg := validateCreateRequest(req); msg != "" {
		httpx.BadRequest(c, msg)
		return
	}
	if len(req.CanvasSnapshot) > maxSnapshotBytes {
		httpx.BadRequest(c, "canvas snapshot too large")
		return
	}
	// 快照非空时必须是合法 JSON，避免脏数据落库导致后续解析失败。
	if len(req.CanvasSnapshot) > 0 && !json.Valid(req.CanvasSnapshot) {
		httpx.BadRequest(c, "canvas snapshot is not valid json")
		return
	}

	uid := middleware.UserIDFrom(c)
	var videoMimeType string
	err := h.pool.QueryRow(c.Request.Context(),
		`SELECT mime_type FROM files WHERE storage_key = $1 AND user_id = $2`,
		req.VideoStorageKey, uid).Scan(&videoMimeType)
	if errors.Is(err, pgx.ErrNoRows) {
		httpx.BadRequest(c, "video file not found")
		return
	}
	if err != nil {
		httpx.Internal(c, err)
		return
	}
	if !strings.HasPrefix(strings.ToLower(videoMimeType), "video/") {
		httpx.BadRequest(c, "contest entry must be a video")
		return
	}
	var coverMimeType string
	err = h.pool.QueryRow(c.Request.Context(),
		`SELECT mime_type FROM files WHERE storage_key = $1 AND user_id = $2`,
		req.CoverStorageKey, uid).Scan(&coverMimeType)
	if errors.Is(err, pgx.ErrNoRows) {
		httpx.BadRequest(c, "video cover not found")
		return
	}
	if err != nil {
		httpx.Internal(c, err)
		return
	}
	if !strings.HasPrefix(strings.ToLower(coverMimeType), "image/") {
		httpx.BadRequest(c, "contest cover must be an image")
		return
	}

	var count int
	if err := h.pool.QueryRow(c.Request.Context(),
		`SELECT count(*) FROM creator_contest_entries WHERE user_id = $1`, uid).Scan(&count); err != nil {
		httpx.Internal(c, err)
		return
	}
	if count >= maxEntriesPerUser {
		httpx.Fail(c, http.StatusConflict, "each creator can submit up to 5 entries")
		return
	}

	var snapshot any // nil → 入库 NULL；非空则存 JSONB。
	if len(req.CanvasSnapshot) > 0 {
		snapshot = req.CanvasSnapshot
	}
	var id string
	err = h.pool.QueryRow(c.Request.Context(),
		`INSERT INTO creator_contest_entries
		 (user_id, video_storage_key, cover_storage_key, title, description, recipe_type, recipe_content, canvas_snapshot)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
		uid, req.VideoStorageKey, req.CoverStorageKey, req.Title, req.Description, req.RecipeType, req.RecipeContent, snapshot,
	).Scan(&id)
	if err != nil {
		// video/cover_storage_key 有唯一约束：同一视频重复投稿会撞约束，返回 409 而非 500。
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			httpx.Fail(c, http.StatusConflict, "this video has already been submitted")
			return
		}
		httpx.Internal(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"id": id})
}

func (h *Handler) List(c *gin.Context) {
	uid := middleware.UserIDFrom(c)
	limit, _ := strconv.Atoi(c.Query("limit"))
	if limit <= 0 || limit > 100 {
		limit = 48
	}
	offset, _ := strconv.Atoi(c.Query("offset"))
	if offset < 0 {
		offset = 0
	}

	// 先审核后公开：广场只展示已通过的作品；「我的投稿」下作者可见自己全部
	// 状态（含审核中 / 已拒绝），以便查看审核进度。
	where := " WHERE e.status = 'approved'"
	if c.Query("scope") == "mine" {
		where = " WHERE e.user_id = $1"
	}
	order := " ORDER BY e.featured DESC, e.featured_at DESC NULLS LAST, e.created_at DESC"
	if c.Query("sort") == "popular" {
		order = " ORDER BY e.featured DESC, e.featured_at DESC NULLS LAST, likes DESC, e.created_at DESC"
	}
	query := `SELECT e.id, e.title, e.description, e.recipe_type,
	                left(e.recipe_content, 180), f.mime_type,
	                e.user_id, COALESCE(NULLIF(u.display_name, ''), split_part(u.email, '@', 1)),
	                COALESCE(lc.likes, 0), EXISTS (
	                    SELECT 1 FROM creator_contest_likes mine
	                    WHERE mine.entry_id = e.id AND mine.user_id = $1
	                ), EXISTS (
	                    SELECT 1 FROM creator_contest_favorites favorite
	                    WHERE favorite.entry_id = e.id AND favorite.user_id = $1
	                ), e.user_id = $1, e.status,
	                e.canvas_snapshot IS NOT NULL AND e.canvas_snapshot <> 'null'::jsonb,
	                e.created_at
	         FROM creator_contest_entries e
	         JOIN users u ON u.id = e.user_id
	         JOIN files f ON f.storage_key = e.video_storage_key
	         LEFT JOIN (
	             SELECT entry_id, count(*)::int AS likes
	             FROM creator_contest_likes GROUP BY entry_id
	         ) lc ON lc.entry_id = e.id` + where + order + ` LIMIT $2 OFFSET $3`

	rows, err := h.pool.Query(c.Request.Context(), query, uid, limit, offset)
	if err != nil {
		httpx.Internal(c, err)
		return
	}
	defer rows.Close()
	items := []Entry{}
	for rows.Next() {
		var item Entry
		var createdAt time.Time
		if err := rows.Scan(&item.ID, &item.Title, &item.Description, &item.RecipeType,
			&item.RecipePreview, &item.VideoMimeType, &item.AuthorID, &item.AuthorName,
			&item.Likes, &item.LikedByMe, &item.FavoritedByMe, &item.Mine, &item.Status, &item.HasWorkflow, &createdAt); err != nil {
			httpx.Internal(c, err)
			return
		}
		item.CreatedAt = createdAt.Format(time.RFC3339)
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		httpx.Internal(c, err)
		return
	}

	// 统计口径与广场一致：只计已通过作品及其作者、点赞。
	var totalEntries, totalCreators, totalLikes int
	if err := h.pool.QueryRow(c.Request.Context(),
		`SELECT (SELECT count(*) FROM creator_contest_entries WHERE status = 'approved'),
		        (SELECT count(DISTINCT user_id) FROM creator_contest_entries WHERE status = 'approved'),
		        (SELECT count(*) FROM creator_contest_likes l
		         JOIN creator_contest_entries e ON e.id = l.entry_id
		         WHERE e.status = 'approved')`,
	).Scan(&totalEntries, &totalCreators, &totalLikes); err != nil {
		httpx.Internal(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"items": items,
		"stats": gin.H{"entries": totalEntries, "creators": totalCreators, "likes": totalLikes},
	})
}

// Showcase 是首页公开作品流：只返回审核通过作品的展示元数据，不包含完整配方、
// 画布快照或私有文件地址。点赞/收藏状态在未登录场景下固定为 false。
func (h *Handler) Showcase(c *gin.Context) {
	limit, _ := strconv.Atoi(c.Query("limit"))
	if limit <= 0 || limit > 24 {
		limit = 9
	}
	rows, err := h.pool.Query(c.Request.Context(),
		`SELECT e.id, e.title, e.description, e.recipe_type,
		        '', f.mime_type,
		        e.user_id, COALESCE(NULLIF(u.display_name, ''), split_part(u.email, '@', 1)),
		        COALESCE(lc.likes, 0), false, false, false, e.status,
		        e.canvas_snapshot IS NOT NULL AND e.canvas_snapshot <> 'null'::jsonb,
		        e.created_at
		 FROM creator_contest_entries e
		 JOIN users u ON u.id=e.user_id AND u.disabled=false
		 JOIN files f ON f.storage_key=e.video_storage_key
		 LEFT JOIN (
		    SELECT entry_id, count(*)::int AS likes FROM creator_contest_likes GROUP BY entry_id
		 ) lc ON lc.entry_id=e.id
		 WHERE e.status='approved'
		 ORDER BY e.featured DESC, e.featured_at DESC NULLS LAST, COALESCE(lc.likes, 0) DESC, e.created_at DESC
		 LIMIT $1`, limit)
	if err != nil {
		httpx.Internal(c, err)
		return
	}
	defer rows.Close()
	items := []Entry{}
	for rows.Next() {
		var item Entry
		var createdAt time.Time
		if err := rows.Scan(&item.ID, &item.Title, &item.Description, &item.RecipeType,
			&item.RecipePreview, &item.VideoMimeType, &item.AuthorID, &item.AuthorName,
			&item.Likes, &item.LikedByMe, &item.FavoritedByMe, &item.Mine,
			&item.Status, &item.HasWorkflow, &createdAt); err != nil {
			httpx.Internal(c, err)
			return
		}
		item.CreatedAt = createdAt.Format(time.RFC3339)
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		httpx.Internal(c, err)
		return
	}
	var entries, creators, likes int
	if err := h.pool.QueryRow(c.Request.Context(),
		`SELECT count(DISTINCT e.id), count(DISTINCT e.user_id), count(l.entry_id)
		 FROM creator_contest_entries e
		 JOIN users u ON u.id=e.user_id AND u.disabled=false
		 LEFT JOIN creator_contest_likes l ON l.entry_id=e.id
		 WHERE e.status='approved'`).Scan(&entries, &creators, &likes); err != nil {
		httpx.Internal(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": items, "stats": gin.H{"entries": entries, "creators": creators, "likes": likes}})
}

func (h *Handler) Detail(c *gin.Context) {
	uid := middleware.UserIDFrom(c)
	item, err := h.findDetail(c, uid, c.Param("id"))
	if errors.Is(err, pgx.ErrNoRows) {
		httpx.NotFound(c, "contest entry not found")
		return
	}
	if err != nil {
		httpx.Internal(c, err)
		return
	}
	// 未通过审核的作品仅作者本人与管理员可见。
	if item.Status != "approved" && !item.Mine && middleware.RoleFrom(c) != "admin" {
		httpx.NotFound(c, "contest entry not found")
		return
	}
	c.JSON(http.StatusOK, gin.H{"entry": item})
}

func (h *Handler) Media(c *gin.Context) {
	h.serveEntryFile(c, "video", false)
}

func (h *Handler) Cover(c *gin.Context) {
	h.serveEntryFile(c, "cover", false)
}

// ShowcaseCover 仅公开仍处于审核通过状态、且作者账号正常的作品封面。
func (h *Handler) ShowcaseCover(c *gin.Context) {
	h.serveEntryFile(c, "cover", true)
}

func (h *Handler) serveEntryFile(c *gin.Context, kind string, publicShowcase bool) {
	if h.store == nil || !h.store.Available() {
		httpx.Fail(c, http.StatusServiceUnavailable, "对象存储未启用或连接不可用")
		return
	}
	var objectKey, mimeType, authorID, status string
	var authorDisabled bool
	column := "e.video_storage_key"
	if kind == "cover" {
		column = "e.cover_storage_key"
	}
	err := h.pool.QueryRow(c.Request.Context(),
		`SELECT f.object_key, f.mime_type, e.user_id, e.status, u.disabled
		 FROM creator_contest_entries e
		 JOIN users u ON u.id = e.user_id
		 JOIN files f ON f.storage_key = `+column+`
		 WHERE e.id = $1`, c.Param("id")).Scan(&objectKey, &mimeType, &authorID, &status, &authorDisabled)
	if errors.Is(err, pgx.ErrNoRows) {
		httpx.NotFound(c, "contest entry not found")
		return
	}
	if err != nil {
		httpx.Internal(c, err)
		return
	}
	if publicShowcase && (status != "approved" || authorDisabled) {
		httpx.NotFound(c, "contest entry not found")
		return
	}
	if status != "approved" && authorID != middleware.UserIDFrom(c) && middleware.RoleFrom(c) != "admin" {
		httpx.NotFound(c, "contest entry not found")
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
	if status == "approved" {
		c.Header("Cache-Control", "public, max-age=3600")
	} else {
		c.Header("Cache-Control", "private, max-age=3600")
	}
	c.Data(http.StatusOK, ct, data)
}

// SnapshotFile 是跨用户读取快照媒体的受控端点：让登录用户能加载「别人已过审
// 作品」画布里的图 / 视频（用于只读查看与复制项目）。三重校验防越权：
//  1. 作品存在且 status='approved'；
//  2. 请求的 storageKey 确实出现在该作品的画布快照里（不能借作品 id 下载任意文件）；
//  3. 用作品作者的 user_id 反查 files.object_key，再取对象。
func (h *Handler) SnapshotFile(c *gin.Context) {
	if h.store == nil || !h.store.Available() {
		httpx.Fail(c, http.StatusServiceUnavailable, "对象存储未启用或连接不可用")
		return
	}
	entryID := c.Param("id")
	storageKey := c.Param("key")

	var authorID, status string
	var snapshot []byte
	err := h.pool.QueryRow(c.Request.Context(),
		`SELECT user_id, status, canvas_snapshot FROM creator_contest_entries WHERE id = $1`,
		entryID).Scan(&authorID, &status, &snapshot)
	if errors.Is(err, pgx.ErrNoRows) {
		httpx.NotFound(c, "contest entry not found")
		return
	}
	if err != nil {
		httpx.Internal(c, err)
		return
	}
	if status != "approved" && authorID != middleware.UserIDFrom(c) && middleware.RoleFrom(c) != "admin" {
		httpx.NotFound(c, "contest entry not found")
		return
	}
	if len(snapshot) == 0 || !snapshotHasStorageKey(snapshot, storageKey) {
		httpx.Forbidden(c, "file is not part of this workflow")
		return
	}

	var objectKey, mimeType string
	err = h.pool.QueryRow(c.Request.Context(),
		`SELECT object_key, mime_type FROM files WHERE storage_key = $1 AND user_id = $2`,
		storageKey, authorID).Scan(&objectKey, &mimeType)
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

// snapshotHasStorageKey 遍历快照 JSON，判断给定 storageKey 是否作为媒体键出现。
// 只有带媒体前缀（image:/video:/audio:/file:）的字符串才被认作可读键，避免
// 把标题、提示词等普通字段误判为可下载文件。
func snapshotHasStorageKey(snapshot []byte, key string) bool {
	if key == "" {
		return false
	}
	hasPrefix := false
	for _, p := range mediaKeyPrefixes {
		if strings.HasPrefix(key, p) {
			hasPrefix = true
			break
		}
	}
	if !hasPrefix {
		return false
	}
	var root any
	if err := json.Unmarshal(snapshot, &root); err != nil {
		return false
	}
	return jsonContainsString(root, key)
}

// jsonContainsString 深度遍历任意 JSON 值，判断是否存在等于 target 的字符串。
func jsonContainsString(v any, target string) bool {
	switch t := v.(type) {
	case string:
		return t == target
	case []any:
		for _, item := range t {
			if jsonContainsString(item, target) {
				return true
			}
		}
	case map[string]any:
		for _, item := range t {
			if jsonContainsString(item, target) {
				return true
			}
		}
	}
	return false
}

// Like 记录一张有效票用于社区排名，不产生任何平台奖励或计费记录。
func (h *Handler) Like(c *gin.Context) {
	uid := middleware.UserIDFrom(c)
	entryID := c.Param("id")

	var authorID, status string
	if err := h.pool.QueryRow(c.Request.Context(),
		`SELECT user_id, status FROM creator_contest_entries WHERE id = $1`, entryID).Scan(&authorID, &status); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			httpx.NotFound(c, "contest entry not found")
			return
		}
		httpx.Internal(c, err)
		return
	}
	if status != "approved" {
		httpx.NotFound(c, "contest entry not found")
		return
	}
	if authorID == uid {
		httpx.Forbidden(c, "you cannot like your own entry")
		return
	}
	if _, err := h.pool.Exec(c.Request.Context(),
		`INSERT INTO creator_contest_likes (entry_id, user_id)
		 VALUES ($1, $2) ON CONFLICT DO NOTHING`, entryID, uid); err != nil {
		httpx.Internal(c, err)
		return
	}
	var likes int
	if err := h.pool.QueryRow(c.Request.Context(),
		`SELECT count(*) FROM creator_contest_likes WHERE entry_id = $1`, entryID).Scan(&likes); err != nil {
		httpx.Internal(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"liked": true, "likes": likes})
}

// Favorite / Unfavorite 管理用户自己的作品收藏。收藏与大赛点赞分离，
// 不参与票数，也允许作者收藏自己的作品作为稍后复用入口。
func (h *Handler) Favorite(c *gin.Context) {
	h.setFavorite(c, true)
}

func (h *Handler) Unfavorite(c *gin.Context) {
	h.setFavorite(c, false)
}

func (h *Handler) setFavorite(c *gin.Context, favorite bool) {
	uid := middleware.UserIDFrom(c)
	entryID := c.Param("id")
	var status string
	if err := h.pool.QueryRow(c.Request.Context(),
		`SELECT status FROM creator_contest_entries WHERE id = $1`, entryID).Scan(&status); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			httpx.NotFound(c, "contest entry not found")
			return
		}
		httpx.Internal(c, err)
		return
	}
	if status != "approved" {
		httpx.NotFound(c, "contest entry not found")
		return
	}
	var err error
	if favorite {
		_, err = h.pool.Exec(c.Request.Context(),
			`INSERT INTO creator_contest_favorites (entry_id, user_id)
			 VALUES ($1, $2) ON CONFLICT DO NOTHING`, entryID, uid)
	} else {
		_, err = h.pool.Exec(c.Request.Context(),
			`DELETE FROM creator_contest_favorites WHERE entry_id = $1 AND user_id = $2`, entryID, uid)
	}
	if err != nil {
		httpx.Internal(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"favorited": favorite})
}

type CreatorProfile struct {
	ID           string `json:"id"`
	DisplayName  string `json:"displayName"`
	AvatarURL    string `json:"avatarUrl"`
	Followers    int    `json:"followers"`
	Following    int    `json:"following"`
	Works        int    `json:"works"`
	Likes        int    `json:"likes"`
	FollowedByMe bool   `json:"followedByMe"`
	Mine         bool   `json:"mine"`
	JoinedAt     string `json:"joinedAt"`
}

// Creator 返回创作者公开主页与已通过作品。邮箱等私密字段不会暴露。
func (h *Handler) Creator(c *gin.Context) {
	uid := middleware.UserIDFrom(c)
	creatorID := c.Param("id")
	var profile CreatorProfile
	var joinedAt time.Time
	err := h.pool.QueryRow(c.Request.Context(),
		`SELECT u.id, COALESCE(NULLIF(u.display_name, ''), split_part(u.email, '@', 1)), u.avatar_url,
		        (SELECT count(*) FROM creator_follows f WHERE f.creator_id = u.id),
		        (SELECT count(*) FROM creator_follows f WHERE f.follower_id = u.id),
		        (SELECT count(*) FROM creator_contest_entries e WHERE e.user_id = u.id AND e.status = 'approved'),
		        (SELECT count(*) FROM creator_contest_likes l
		         JOIN creator_contest_entries e ON e.id = l.entry_id
		         WHERE e.user_id = u.id AND e.status = 'approved'),
		        EXISTS (SELECT 1 FROM creator_follows f WHERE f.follower_id = $1 AND f.creator_id = u.id),
		        u.id = $1, u.created_at
		 FROM users u WHERE u.id = $2 AND u.disabled = false`, uid, creatorID,
	).Scan(&profile.ID, &profile.DisplayName, &profile.AvatarURL, &profile.Followers,
		&profile.Following, &profile.Works, &profile.Likes, &profile.FollowedByMe,
		&profile.Mine, &joinedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		httpx.NotFound(c, "creator not found")
		return
	}
	if err != nil {
		httpx.Internal(c, err)
		return
	}
	profile.JoinedAt = joinedAt.Format(time.RFC3339)

	items, err := h.queryEntries(c.Request.Context(), communityEntrySelect+`
		 WHERE e.status = 'approved' AND e.user_id = $2
		 ORDER BY e.created_at DESC LIMIT 48`, uid, creatorID)
	if err != nil {
		httpx.Internal(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"creator": profile, "items": items})
}

// Feed 聚合关注创作者的新作品或当前用户收藏的作品。
func (h *Handler) Feed(c *gin.Context) {
	uid := middleware.UserIDFrom(c)
	limit, _ := strconv.Atoi(c.Query("limit"))
	if limit <= 0 || limit > 100 {
		limit = 48
	}
	offset, _ := strconv.Atoi(c.Query("offset"))
	if offset < 0 {
		offset = 0
	}

	where := " WHERE e.status = 'approved'"
	order := " ORDER BY COALESCE(lc.likes, 0) DESC, e.created_at DESC"
	scope := c.Query("scope")
	if scope == "following" {
		where += ` AND EXISTS (
			SELECT 1 FROM creator_follows follow
			WHERE follow.follower_id = $1 AND follow.creator_id = e.user_id
		)`
		order = " ORDER BY e.created_at DESC"
	} else if scope == "favorites" {
		where = ` WHERE e.status = 'approved' AND EXISTS (
			SELECT 1 FROM creator_contest_favorites favorite
			WHERE favorite.user_id = $1 AND favorite.entry_id = e.id
		)`
		order = ` ORDER BY (
			SELECT favorite.created_at FROM creator_contest_favorites favorite
			WHERE favorite.user_id = $1 AND favorite.entry_id = e.id
		) DESC`
	} else if scope != "" && scope != "discover" {
		httpx.BadRequest(c, "invalid feed scope")
		return
	}

	items, err := h.queryEntries(c.Request.Context(), communityEntrySelect+where+order+` LIMIT $2 OFFSET $3`, uid, limit, offset)
	if err != nil {
		httpx.Internal(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": items})
}

func (h *Handler) Follow(c *gin.Context) {
	h.setFollowing(c, true)
}

func (h *Handler) Unfollow(c *gin.Context) {
	h.setFollowing(c, false)
}

func (h *Handler) setFollowing(c *gin.Context, following bool) {
	uid := middleware.UserIDFrom(c)
	creatorID := c.Param("id")
	if uid == creatorID {
		httpx.BadRequest(c, "you cannot follow yourself")
		return
	}
	var exists bool
	if err := h.pool.QueryRow(c.Request.Context(),
		`SELECT EXISTS (SELECT 1 FROM users WHERE id = $1 AND disabled = false)`, creatorID).Scan(&exists); err != nil {
		httpx.Internal(c, err)
		return
	}
	if !exists {
		httpx.NotFound(c, "creator not found")
		return
	}
	var err error
	if following {
		_, err = h.pool.Exec(c.Request.Context(),
			`INSERT INTO creator_follows (follower_id, creator_id)
			 VALUES ($1, $2) ON CONFLICT DO NOTHING`, uid, creatorID)
	} else {
		_, err = h.pool.Exec(c.Request.Context(),
			`DELETE FROM creator_follows WHERE follower_id = $1 AND creator_id = $2`, uid, creatorID)
	}
	if err != nil {
		httpx.Internal(c, err)
		return
	}
	var followers int
	if err := h.pool.QueryRow(c.Request.Context(),
		`SELECT count(*) FROM creator_follows WHERE creator_id = $1`, creatorID).Scan(&followers); err != nil {
		httpx.Internal(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"following": following, "followers": followers})
}

const communityEntrySelect = `SELECT e.id, e.title, e.description, e.recipe_type,
		left(e.recipe_content, 180), f.mime_type,
		e.user_id, COALESCE(NULLIF(u.display_name, ''), split_part(u.email, '@', 1)),
		COALESCE(lc.likes, 0),
		EXISTS (SELECT 1 FROM creator_contest_likes mine WHERE mine.entry_id = e.id AND mine.user_id = $1),
		EXISTS (SELECT 1 FROM creator_contest_favorites favorite WHERE favorite.entry_id = e.id AND favorite.user_id = $1),
		e.user_id = $1, e.status,
		e.canvas_snapshot IS NOT NULL AND e.canvas_snapshot <> 'null'::jsonb,
		e.created_at
	FROM creator_contest_entries e
	JOIN users u ON u.id = e.user_id
	JOIN files f ON f.storage_key = e.video_storage_key
	LEFT JOIN (
		SELECT entry_id, count(*)::int AS likes
		FROM creator_contest_likes GROUP BY entry_id
	) lc ON lc.entry_id = e.id`

func (h *Handler) queryEntries(ctx context.Context, query string, args ...any) ([]Entry, error) {
	rows, err := h.pool.Query(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []Entry{}
	for rows.Next() {
		var item Entry
		var createdAt time.Time
		if err := rows.Scan(&item.ID, &item.Title, &item.Description, &item.RecipeType,
			&item.RecipePreview, &item.VideoMimeType, &item.AuthorID, &item.AuthorName,
			&item.Likes, &item.LikedByMe, &item.FavoritedByMe, &item.Mine,
			&item.Status, &item.HasWorkflow, &createdAt); err != nil {
			return nil, err
		}
		item.CreatedAt = createdAt.Format(time.RFC3339)
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return items, nil
}

func (h *Handler) findDetail(c *gin.Context, uid, id string) (Detail, error) {
	var item Detail
	var createdAt time.Time
	var snapshot []byte
	err := h.pool.QueryRow(c.Request.Context(),
		`SELECT e.id, e.title, e.description, e.recipe_type,
		        left(e.recipe_content, 180), e.recipe_content, f.mime_type,
		        e.user_id, COALESCE(NULLIF(u.display_name, ''), split_part(u.email, '@', 1)),
		        (SELECT count(*) FROM creator_contest_likes l WHERE l.entry_id = e.id),
		        EXISTS (SELECT 1 FROM creator_contest_likes l WHERE l.entry_id = e.id AND l.user_id = $1),
		        EXISTS (SELECT 1 FROM creator_contest_favorites f WHERE f.entry_id = e.id AND f.user_id = $1),
		        e.user_id = $1, e.status, e.created_at, e.canvas_snapshot
		 FROM creator_contest_entries e
		 JOIN users u ON u.id = e.user_id
		 JOIN files f ON f.storage_key = e.video_storage_key
		 WHERE e.id = $2`, uid, id,
	).Scan(&item.ID, &item.Title, &item.Description, &item.RecipeType,
		&item.RecipePreview, &item.RecipeContent, &item.VideoMimeType,
		&item.AuthorID, &item.AuthorName, &item.Likes, &item.LikedByMe, &item.FavoritedByMe, &item.Mine, &item.Status, &createdAt, &snapshot)
	if err == nil {
		item.CreatedAt = createdAt.Format(time.RFC3339)
		if hasCanvasSnapshot(snapshot) {
			item.CanvasSnapshot = json.RawMessage(snapshot)
			item.HasWorkflow = true
		}
	}
	return item, err
}

func normalizeCreateRequest(req *createRequest) {
	req.VideoStorageKey = strings.TrimSpace(req.VideoStorageKey)
	req.CoverStorageKey = strings.TrimSpace(req.CoverStorageKey)
	req.Title = strings.TrimSpace(req.Title)
	req.Description = strings.TrimSpace(req.Description)
	req.RecipeType = strings.ToLower(strings.TrimSpace(req.RecipeType))
	req.RecipeContent = strings.TrimSpace(req.RecipeContent)
	trimmedSnapshot := bytes.TrimSpace(req.CanvasSnapshot)
	if len(trimmedSnapshot) == 0 || bytes.Equal(trimmedSnapshot, []byte("null")) {
		req.CanvasSnapshot = nil
	} else {
		req.CanvasSnapshot = json.RawMessage(trimmedSnapshot)
	}
}

func hasCanvasSnapshot(snapshot []byte) bool {
	trimmed := bytes.TrimSpace(snapshot)
	return len(trimmed) > 0 && !bytes.Equal(trimmed, []byte("null"))
}

func validateCreateRequest(req createRequest) string {
	if req.VideoStorageKey == "" || req.CoverStorageKey == "" || req.Title == "" || req.RecipeContent == "" {
		return "video, cover, title and recipe content are required"
	}
	if req.RecipeType != "prompt" && req.RecipeType != "skill" {
		return "recipeType must be prompt or skill"
	}
	if utf8.RuneCountInString(req.Title) > 80 {
		return "title is too long"
	}
	if utf8.RuneCountInString(req.Description) > 500 {
		return "description is too long"
	}
	if utf8.RuneCountInString(req.RecipeContent) > 20000 {
		return "recipe content is too long"
	}
	return ""
}

// AdminEntry 是管理端审核列表的行，比公开 Entry 多出审核元数据。
type AdminEntry struct {
	ID            string `json:"id"`
	Title         string `json:"title"`
	Description   string `json:"description"`
	RecipeType    string `json:"recipeType"`
	RecipeContent string `json:"recipeContent"`
	VideoMimeType string `json:"videoMimeType"`
	AuthorID      string `json:"authorId"`
	AuthorName    string `json:"authorName"`
	AuthorEmail   string `json:"authorEmail"`
	Likes         int    `json:"likes"`
	Status        string `json:"status"`
	ReviewNote    string `json:"reviewNote"`
	Featured      bool   `json:"featured"`
	CreatedAt     string `json:"createdAt"`
}

// AdminList 供管理员审核：默认列出待审作品，可用 ?status= 过滤。
func (h *Handler) AdminList(c *gin.Context) {
	status := c.Query("status")
	where := ""
	args := []any{}
	switch status {
	case "", "pending", "approved", "rejected":
		if status != "" {
			where = " WHERE e.status = $1"
			args = append(args, status)
		}
	case "all":
		// 不加过滤
	default:
		httpx.BadRequest(c, "invalid status")
		return
	}
	if status == "" {
		where = " WHERE e.status = 'pending'"
	}

	query := `SELECT e.id, e.title, e.description, e.recipe_type, e.recipe_content, f.mime_type,
	                e.user_id, COALESCE(NULLIF(u.display_name, ''), split_part(u.email, '@', 1)), u.email,
	                (SELECT count(*) FROM creator_contest_likes l WHERE l.entry_id = e.id),
	                e.status, e.review_note, e.featured, e.created_at
	         FROM creator_contest_entries e
	         JOIN users u ON u.id = e.user_id
	         JOIN files f ON f.storage_key = e.video_storage_key` + where +
		` ORDER BY e.created_at DESC LIMIT 200`

	rows, err := h.pool.Query(c.Request.Context(), query, args...)
	if err != nil {
		httpx.Internal(c, err)
		return
	}
	defer rows.Close()
	items := []AdminEntry{}
	for rows.Next() {
		var item AdminEntry
		var createdAt time.Time
		if err := rows.Scan(&item.ID, &item.Title, &item.Description, &item.RecipeType, &item.RecipeContent,
			&item.VideoMimeType, &item.AuthorID, &item.AuthorName, &item.AuthorEmail, &item.Likes,
			&item.Status, &item.ReviewNote, &item.Featured, &createdAt); err != nil {
			httpx.Internal(c, err)
			return
		}
		item.CreatedAt = createdAt.Format(time.RFC3339)
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		httpx.Internal(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": items})
}

type featureRequest struct {
	Featured bool `json:"featured"`
}

func (h *Handler) Feature(c *gin.Context) {
	var req featureRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		httpx.BadRequest(c, "featured required")
		return
	}
	tag, err := h.pool.Exec(c.Request.Context(),
		`UPDATE creator_contest_entries
		 SET featured=$2, featured_at=CASE WHEN $2 THEN now() ELSE NULL END
		 WHERE id=$1 AND status='approved'`, c.Param("id"), req.Featured)
	if err != nil {
		httpx.Internal(c, err)
		return
	}
	if tag.RowsAffected() == 0 {
		httpx.BadRequest(c, "only approved entries can be featured")
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

type reviewRequest struct {
	Action string `json:"action"`
	Note   string `json:"note"`
}

// Review 通过或拒绝一件作品。只有 approved 的作品才会出现在公开广场。
func (h *Handler) Review(c *gin.Context) {
	var req reviewRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		httpx.BadRequest(c, "invalid body")
		return
	}
	var status string
	switch req.Action {
	case "approve":
		status = "approved"
	case "reject":
		status = "rejected"
	default:
		httpx.BadRequest(c, "action must be approve or reject")
		return
	}
	note := strings.TrimSpace(req.Note)
	if utf8.RuneCountInString(note) > 500 {
		httpx.BadRequest(c, "review note is too long")
		return
	}
	// 拒绝时一并撤下首页推荐，避免被拒作品残留 featured=true：
	// 既让管理列表状态自洽，也防止它重新过审后自动回到推荐位。
	tag, err := h.pool.Exec(c.Request.Context(),
		`UPDATE creator_contest_entries
		 SET status = $2, review_note = $3, reviewed_at = now(),
		     featured = CASE WHEN $2 = 'rejected' THEN false ELSE featured END,
		     featured_at = CASE WHEN $2 = 'rejected' THEN NULL ELSE featured_at END
		 WHERE id = $1`, c.Param("id"), status, note)
	if err != nil {
		httpx.Internal(c, err)
		return
	}
	if tag.RowsAffected() == 0 {
		httpx.NotFound(c, "contest entry not found")
		return
	}
	c.JSON(http.StatusOK, gin.H{"status": status})
}
