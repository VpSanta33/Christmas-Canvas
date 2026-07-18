// Package admin 汇集仅管理员可用的用户管理、用量统计与系统概览接口。
package admin

import (
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/basketikun/infinite-canvas/server/internal/auth"
	"github.com/basketikun/infinite-canvas/server/internal/credits"
	"github.com/basketikun/infinite-canvas/server/internal/httpx"
	"github.com/basketikun/infinite-canvas/server/internal/middleware"
	"github.com/basketikun/infinite-canvas/server/internal/storage"
)

// Handler 承接 /api/admin 下的用户管理、用量与概览。渠道管理在 proxy.AdminHandler。
type Handler struct {
	pool    *pgxpool.Pool
	users   *auth.Store
	credits *credits.Service
	store   *storage.Manager // 动态对象存储；删除用户/预览媒体时读取当前生效配置
}

func NewHandler(pool *pgxpool.Pool, users *auth.Store, creditsSvc *credits.Service, store *storage.Manager) *Handler {
	return &Handler{pool: pool, users: users, credits: creditsSvc, store: store}
}

// ListUsers 返回全部用户（含配额与当日用量）。
func (h *Handler) ListUsers(c *gin.Context) {
	list, err := h.users.ListUsers(c.Request.Context())
	if err != nil {
		httpx.Internal(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"users": list})
}

type createUserReq struct {
	Email       string `json:"email"`
	Password    string `json:"password"`
	DisplayName string `json:"displayName"`
	Role        string `json:"role"`
	Credits     int64  `json:"credits"`
}

// CreateUser 由管理员直接创建账号（不受开放注册开关限制）。
func (h *Handler) CreateUser(c *gin.Context) {
	var req createUserReq
	if err := c.ShouldBindJSON(&req); err != nil {
		httpx.BadRequest(c, "invalid body")
		return
	}
	if !strings.Contains(req.Email, "@") || len(req.Password) < 8 || len(req.Password) > 72 {
		httpx.BadRequest(c, "邮箱不合法或密码长度不在 8-72 字节范围内")
		return
	}
	role := req.Role
	if role != "admin" && role != "operator" {
		role = "user"
	}
	name := strings.TrimSpace(req.DisplayName)
	if name == "" {
		name = strings.Split(req.Email, "@")[0]
	}
	hash, err := auth.HashPassword(req.Password)
	if err != nil {
		httpx.Internal(c, err)
		return
	}
	// 管理员人工建号视为已核验，不走公开注册邮件流程。
	u, err := h.users.Create(c.Request.Context(), req.Email, hash, name, role, true)
	if errors.Is(err, auth.ErrEmailTaken) {
		httpx.Fail(c, http.StatusConflict, "该邮箱已被注册")
		return
	}
	if err != nil {
		httpx.Internal(c, err)
		return
	}
	// 可选初始积分：失败不阻断建号，仅让余额保持 0。
	if h.credits != nil && req.Credits > 0 {
		if bal, gErr := h.credits.Grant(c.Request.Context(), u.ID, req.Credits, credits.ReasonTopup, "管理员建号赠送"); gErr == nil {
			u.Credits = bal
		}
	}
	c.JSON(http.StatusOK, gin.H{"user": u})
}

// DeleteUser 删除用户及其全部数据。关联表由外键 CASCADE 清除；对象存储中的媒体二进制
// 在删库前逐个移除（存储未启用时跳过）。禁止删除自己，避免管理员误删当前账号。
func (h *Handler) DeleteUser(c *gin.Context) {
	id := c.Param("id")
	if id == middleware.UserIDFrom(c) {
		httpx.BadRequest(c, "不能删除自己")
		return
	}
	if _, err := h.users.FindByID(c.Request.Context(), id); err != nil {
		if errors.Is(err, auth.ErrNotFound) {
			httpx.NotFound(c, "user not found")
			return
		}
		httpx.Internal(c, err)
		return
	}
	// 先清对象存储：查出该用户全部 object_key 再逐个删除。失败仅记日志，不阻断删库。
	if h.store != nil && h.store.Available() {
		rows, err := h.pool.Query(c.Request.Context(), `SELECT object_key FROM files WHERE user_id = $1`, id)
		if err == nil {
			var keys []string
			for rows.Next() {
				var k string
				if rows.Scan(&k) == nil {
					keys = append(keys, k)
				}
			}
			rows.Close()
			for _, k := range keys {
				_ = h.store.Delete(c.Request.Context(), k)
			}
		}
	}
	if err := mapUserErr(c, h.users.DeleteUser(c.Request.Context(), id)); err {
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

type setRoleReq struct {
	Role string `json:"role"`
}

// SetRole 设置用户角色。禁止管理员降级自己，避免误操作把最后一个 admin 锁在门外。
func (h *Handler) SetRole(c *gin.Context) {
	id := c.Param("id")
	var req setRoleReq
	if err := c.ShouldBindJSON(&req); err != nil || (req.Role != "user" && req.Role != "operator" && req.Role != "admin") {
		httpx.BadRequest(c, "role must be user, operator or admin")
		return
	}
	if id == middleware.UserIDFrom(c) && req.Role != "admin" {
		httpx.BadRequest(c, "cannot demote yourself")
		return
	}
	var currentRole string
	if err := h.pool.QueryRow(c.Request.Context(), `SELECT role FROM users WHERE id=$1`, id).Scan(&currentRole); err != nil {
		httpx.Internal(c, err)
		return
	}
	if currentRole == "admin" && req.Role != "admin" {
		var admins int
		if err := h.pool.QueryRow(c.Request.Context(), `SELECT count(*) FROM users WHERE role='admin' AND disabled=false`).Scan(&admins); err != nil {
			httpx.Internal(c, err)
			return
		}
		if admins <= 1 {
			httpx.BadRequest(c, "cannot demote the last super admin")
			return
		}
	}
	if err := mapUserErr(c, h.users.SetRole(c.Request.Context(), id, req.Role)); err {
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

type setDisabledReq struct {
	Disabled bool `json:"disabled"`
}

// SetDisabled 启用/禁用用户。禁止禁用自己。
func (h *Handler) SetDisabled(c *gin.Context) {
	id := c.Param("id")
	var req setDisabledReq
	if err := c.ShouldBindJSON(&req); err != nil {
		httpx.BadRequest(c, "disabled required")
		return
	}
	if id == middleware.UserIDFrom(c) && req.Disabled {
		httpx.BadRequest(c, "cannot disable yourself")
		return
	}
	if err := mapUserErr(c, h.users.SetDisabled(c.Request.Context(), id, req.Disabled)); err {
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

type setQuotaReq struct {
	DailyLimit int `json:"dailyLimit"`
}

// SetQuota 设置用户每日配额。
func (h *Handler) SetQuota(c *gin.Context) {
	id := c.Param("id")
	var req setQuotaReq
	if err := c.ShouldBindJSON(&req); err != nil || req.DailyLimit < 0 {
		httpx.BadRequest(c, "dailyLimit must be >= 0")
		return
	}
	if err := h.users.SetDailyLimit(c.Request.Context(), id, req.DailyLimit); err != nil {
		httpx.Internal(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

type topupReq struct {
	Amount int64  `json:"amount"`
	Note   string `json:"note"`
}

// Topup 给指定用户充值积分（正数）。返回充值后余额。
func (h *Handler) Topup(c *gin.Context) {
	id := c.Param("id")
	var req topupReq
	if err := c.ShouldBindJSON(&req); err != nil || req.Amount <= 0 {
		httpx.BadRequest(c, "amount must be > 0")
		return
	}
	// 确认用户存在，避免给不存在的 id 写台账。
	if _, err := h.users.FindByID(c.Request.Context(), id); err != nil {
		if errors.Is(err, auth.ErrNotFound) {
			httpx.NotFound(c, "user not found")
			return
		}
		httpx.Internal(c, err)
		return
	}
	bal, err := h.credits.Grant(c.Request.Context(), id, req.Amount, credits.ReasonTopup, req.Note)
	if err != nil {
		httpx.Internal(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"credits": bal})
}

// UserLedger 返回指定用户最近的积分流水，供 admin 在用户管理里下钻查看消费/充值记录。
func (h *Handler) UserLedger(c *gin.Context) {
	id := c.Param("id")
	limit, _ := strconv.Atoi(c.Query("limit"))
	if _, err := h.users.FindByID(c.Request.Context(), id); err != nil {
		if errors.Is(err, auth.ErrNotFound) {
			httpx.NotFound(c, "user not found")
			return
		}
		httpx.Internal(c, err)
		return
	}
	items, err := h.credits.History(c.Request.Context(), id, limit)
	if err != nil {
		httpx.Internal(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": items})
}

// mapUserErr 把 store 错误映射为 HTTP 响应，返回 true 表示已写出错误响应。
func mapUserErr(c *gin.Context, err error) bool {
	if err == nil {
		return false
	}
	if errors.Is(err, auth.ErrNotFound) {
		httpx.NotFound(c, "user not found")
		return true
	}
	httpx.Internal(c, err)
	return true
}
