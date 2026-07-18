// Package router 装配 HTTP 路由。从 cmd/api 抽出，便于阅读与单元测试。
package router

import (
	"log"
	"net/http"
	"time"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/basketikun/infinite-canvas/server/internal/admin"
	"github.com/basketikun/infinite-canvas/server/internal/asset"
	"github.com/basketikun/infinite-canvas/server/internal/audit"
	"github.com/basketikun/infinite-canvas/server/internal/auth"
	"github.com/basketikun/infinite-canvas/server/internal/canvas"
	"github.com/basketikun/infinite-canvas/server/internal/config"
	"github.com/basketikun/infinite-canvas/server/internal/contest"
	"github.com/basketikun/infinite-canvas/server/internal/credits"
	filepkg "github.com/basketikun/infinite-canvas/server/internal/file"
	"github.com/basketikun/infinite-canvas/server/internal/middleware"
	"github.com/basketikun/infinite-canvas/server/internal/platform"
	"github.com/basketikun/infinite-canvas/server/internal/proxy"
	"github.com/basketikun/infinite-canvas/server/internal/quota"
	"github.com/basketikun/infinite-canvas/server/internal/storage"
)

// Deps 汇集 New 所需的全部依赖，避免超长参数列表。字段导出以便 cmd/api 装配。
type Deps struct {
	Cfg             *config.Config
	AuthMgr         *auth.Manager
	AuthHandler     *auth.Handler
	CanvasHandler   *canvas.Handler
	AssetHandler    *asset.Handler
	FileHandler     *filepkg.Handler
	ProxyHandler    *proxy.Handler
	ChannelAdmin    *proxy.AdminHandler
	AdminHandler    *admin.Handler
	StorageAdmin    *storage.AdminHandler
	CreditsHandler  *credits.Handler
	ContestHandler  *contest.Handler
	QuotaSvc        *quota.Service
	UserStore       *auth.Store
	PlatformHandler *platform.Handler
	Pool            *pgxpool.Pool
}

// New 装配并返回 gin 引擎。
func New(d Deps) *gin.Engine {
	r := gin.New()
	r.Use(gin.Logger(), gin.Recovery(), middleware.RequestID())
	r.MaxMultipartMemory = 16 << 20
	// 浏览器规范：Access-Control-Allow-Origin: * 与 credentials 不能共存，带 * 时若再开
	// AllowCredentials，浏览器会直接拒绝跨域响应。故仅在显式列出白名单来源时才允许携带凭据。
	allowCredentials := true
	for _, o := range d.Cfg.CORSOrigins {
		if o == "*" {
			allowCredentials = false
			log.Printf("warning: CORS_ORIGINS is '*'; credentials disabled. Set explicit origins in production.")
			break
		}
	}
	r.Use(cors.New(cors.Config{
		AllowOrigins:     d.Cfg.CORSOrigins,
		AllowMethods:     []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"},
		AllowHeaders:     []string{"Origin", "Content-Type", "Authorization", "X-Goog-Api-Key", "X-Admin-Confirm", "X-Request-ID"},
		ExposeHeaders:    []string{"X-Request-ID", "X-Infinite-Canvas-Failover", "X-Infinite-Canvas-Attempts"},
		AllowCredentials: allowCredentials,
		MaxAge:           12 * time.Hour,
	}))

	r.GET("/healthz", func(c *gin.Context) { c.JSON(http.StatusOK, gin.H{"ok": true}) })

	api := r.Group("/api")
	registerPublicRoutes(api, d)
	registerAuthRoutes(api, d)
	registerUserRoutes(api, d)
	registerAIRoutes(api, d)
	registerAdminRoutes(api, d)

	return r
}

// registerPublicRoutes 挂载无需登录的只读目录：首页访客也能看到管理员配置的模型与
// 积分价格；响应不包含上游地址和 API Key，实际调用仍必须经过登录鉴权。
func registerPublicRoutes(api *gin.RouterGroup, d Deps) {
	api.GET("/channels", d.ChannelAdmin.ListPublic)
	api.GET("/platform", d.PlatformHandler.Public)
	api.GET("/showcase", d.ContestHandler.Showcase)
	api.GET("/showcase/:id/cover", d.ContestHandler.ShowcaseCover)
}

// registerAuthRoutes 挂载公开认证端点（按 IP 限流，抵御暴力破解）。
func registerAuthRoutes(api *gin.RouterGroup, d Deps) {
	authGroup := api.Group("/auth")
	authGroup.POST("/register", d.QuotaSvc.RateLimitByIP("register", 10), d.AuthHandler.Register)
	authGroup.POST("/verify-email", d.QuotaSvc.RateLimitByIP("verify-email", 15), d.AuthHandler.VerifyEmail)
	authGroup.POST("/resend-verification", d.QuotaSvc.RateLimitByIP("resend-verification", 5), d.AuthHandler.ResendVerification)
	authGroup.POST("/login", d.QuotaSvc.RateLimitByIP("login", 10), d.AuthHandler.Login)
	authGroup.POST("/refresh", d.QuotaSvc.RateLimitByIP("refresh", 30), d.AuthHandler.Refresh)
}

// registerUserRoutes 挂载登录用户的受保护端点：画布/资产/文件/积分/大赛/社区。
func registerUserRoutes(api *gin.RouterGroup, d Deps) {
	authed := api.Group("")
	authed.Use(middleware.RequireAuthWithSession(d.AuthMgr, d.UserStore))
	authed.GET("/auth/me", func(c *gin.Context) { d.AuthHandler.Me(c, middleware.UserIDFrom(c)) })
	authed.POST("/auth/logout", func(c *gin.Context) { d.AuthHandler.Logout(c, middleware.UserIDFrom(c)) })

	authed.GET("/projects", d.CanvasHandler.List)
	authed.PUT("/projects", d.CanvasHandler.Replace)
	authed.POST("/projects", d.CanvasHandler.Upsert)
	authed.DELETE("/projects/:id", d.CanvasHandler.Delete)

	authed.GET("/assets", d.AssetHandler.List)
	authed.PUT("/assets", d.AssetHandler.Replace)
	authed.POST("/assets", d.AssetHandler.Upsert)
	authed.DELETE("/assets/:id", d.AssetHandler.Delete)

	authed.POST("/files", d.FileHandler.Upload)
	authed.GET("/files/:key", d.FileHandler.Download)
	authed.DELETE("/files/:key", d.FileHandler.Trash)

	authed.GET("/usage", d.QuotaSvc.Summary)

	// 积分：余额与流水
	authed.GET("/credits", d.CreditsHandler.Balance)
	authed.GET("/credits/ledger", d.CreditsHandler.Ledger)

	// 创作者大赛：视频投稿、公开创作配方与点赞排名。
	authed.GET("/contest", d.ContestHandler.List)
	authed.POST("/contest", d.ContestHandler.Create)
	authed.GET("/contest/:id", d.ContestHandler.Detail)
	authed.GET("/contest/:id/cover", d.ContestHandler.Cover)
	authed.GET("/contest/:id/media", d.ContestHandler.Media)
	authed.GET("/contest/:id/files/:key", d.ContestHandler.SnapshotFile)
	authed.POST("/contest/:id/like", d.ContestHandler.Like)
	authed.POST("/contest/:id/favorite", d.ContestHandler.Favorite)
	authed.DELETE("/contest/:id/favorite", d.ContestHandler.Unfavorite)

	// 创作者社区：关注流、收藏列表与公开创作者主页。
	authed.GET("/creators/feed", d.ContestHandler.Feed)
	authed.GET("/creators/:id", d.ContestHandler.Creator)
	authed.POST("/creators/:id/follow", d.ContestHandler.Follow)
	authed.DELETE("/creators/:id/follow", d.ContestHandler.Unfollow)
}

// registerAIRoutes 挂载 AI 代理：独立分组用弹性鉴权（JWT 可来自 Authorization 或
// x-goog-api-key），限流 + 配额后透明转发（含 SSE）。不挂在 authed 下，避免严格
// RequireAuth 拒掉 gemini 请求。
func registerAIRoutes(api *gin.RouterGroup, d Deps) {
	aiGroup := api.Group("/ai")
	aiGroup.Use(middleware.RequireAuthFlexibleWithSession(d.AuthMgr, d.UserStore), d.QuotaSvc.RateLimit(30), d.QuotaSvc.CheckDailyQuota())
	aiGroup.Any("/:channelId/*path", d.ProxyHandler.Forward)
}

// registerAdminRoutes 挂载管理后台：渠道 / 用户 / 概览 / 平台设置 / 大赛审核，
// 全部经 RequireAdmin + 审计中间件，敏感写操作再叠加超管与二次确认。
func registerAdminRoutes(api *gin.RouterGroup, d Deps) {
	authed := api.Group("")
	authed.Use(middleware.RequireAuthWithSession(d.AuthMgr, d.UserStore))
	adminGroup := authed.Group("/admin")
	adminGroup.Use(middleware.RequireAdmin(), audit.Middleware(d.Pool))
	// 渠道管理
	adminGroup.GET("/channels", d.ChannelAdmin.ListAll)
	adminGroup.GET("/model-defaults", d.ChannelAdmin.GetModelDefaults)
	adminGroup.PUT("/model-defaults", middleware.RequireSuperAdmin(), d.ChannelAdmin.UpdateModelDefaults)
	adminGroup.PUT("/channels/:id/model-pricing", middleware.RequireSuperAdmin(), d.ChannelAdmin.UpdateModelPricing)
	adminGroup.POST("/channels", middleware.RequireSuperAdmin(), d.ChannelAdmin.Create)
	adminGroup.PUT("/channels/:id", middleware.RequireSuperAdmin(), d.ChannelAdmin.Update)
	adminGroup.POST("/channels/:id/enabled", middleware.RequireSuperAdmin(), d.ChannelAdmin.SetEnabled)
	adminGroup.DELETE("/channels/:id", middleware.RequireSuperAdmin(), middleware.RequireAdminConfirmation(), d.ChannelAdmin.Delete)
	adminGroup.POST("/channels/:id/test", middleware.RequireSuperAdmin(), d.ChannelAdmin.Test)
	adminGroup.POST("/channel-test", middleware.RequireSuperAdmin(), d.ChannelAdmin.Test) // 保存前用表单数据现场测试（无 id）
	// 用户管理
	adminGroup.GET("/users", middleware.RequireSuperAdmin(), d.AdminHandler.ListUsers)
	adminGroup.POST("/users", middleware.RequireSuperAdmin(), d.AdminHandler.CreateUser)
	adminGroup.DELETE("/users/:id", middleware.RequireSuperAdmin(), middleware.RequireAdminConfirmation(), d.AdminHandler.DeleteUser)
	adminGroup.POST("/users/:id/role", middleware.RequireSuperAdmin(), middleware.RequireAdminConfirmation(), d.AdminHandler.SetRole)
	adminGroup.POST("/users/:id/disabled", middleware.RequireSuperAdmin(), d.AdminHandler.SetDisabled)
	adminGroup.POST("/users/:id/quota", middleware.RequireSuperAdmin(), d.AdminHandler.SetQuota)
	adminGroup.POST("/users/:id/credits", middleware.RequireSuperAdmin(), d.AdminHandler.Topup)
	adminGroup.POST("/users/:id/revoke-sessions", middleware.RequireSuperAdmin(), middleware.RequireAdminConfirmation(), d.AdminHandler.RevokeUserSessions)
	adminGroup.GET("/users/:id/ledger", middleware.RequireSuperAdmin(), d.AdminHandler.UserLedger)
	// 用户媒体预览与调用记录（排障）
	adminGroup.GET("/users/:id/media", middleware.RequireSuperAdmin(), d.AdminHandler.UserMedia)
	adminGroup.GET("/users/:id/media/:key", middleware.RequireSuperAdmin(), d.AdminHandler.MediaPreview)
	adminGroup.GET("/users/:id/usage", middleware.RequireSuperAdmin(), d.AdminHandler.UserUsage)
	// 概览与用量
	adminGroup.GET("/overview", d.AdminHandler.Overview)
	adminGroup.GET("/usage", d.AdminHandler.Usage)
	adminGroup.GET("/call-logs", d.AdminHandler.CallLogs)
	adminGroup.GET("/channel-health", d.AdminHandler.ChannelHealth)
	adminGroup.GET("/platform", d.PlatformHandler.AdminGet)
	adminGroup.PUT("/platform", middleware.RequireSuperAdmin(), d.PlatformHandler.AdminUpdate)
	adminGroup.GET("/announcement-settings", middleware.RequireSuperAdmin(), d.PlatformHandler.AdminGetAnnouncements)
	adminGroup.PUT("/announcement-settings", middleware.RequireSuperAdmin(), d.PlatformHandler.AdminUpdateAnnouncements)
	adminGroup.GET("/email-settings", middleware.RequireSuperAdmin(), d.PlatformHandler.AdminGetEmail)
	adminGroup.PUT("/email-settings", middleware.RequireSuperAdmin(), d.PlatformHandler.AdminUpdateEmail)
	adminGroup.POST("/email-settings/test", middleware.RequireSuperAdmin(), d.PlatformHandler.AdminTestEmail)
	adminGroup.GET("/storage-settings", middleware.RequireSuperAdmin(), d.StorageAdmin.Get)
	adminGroup.PUT("/storage-settings", middleware.RequireSuperAdmin(), d.StorageAdmin.Update)
	adminGroup.POST("/storage-settings/test", middleware.RequireSuperAdmin(), d.StorageAdmin.Test)
	adminGroup.GET("/storage-cleanup", middleware.RequireSuperAdmin(), d.StorageAdmin.CleanupStats)
	adminGroup.POST("/storage-cleanup", middleware.RequireSuperAdmin(), middleware.RequireAdminConfirmation(), d.StorageAdmin.PurgeExpired)
	adminGroup.GET("/audit-logs", middleware.RequireSuperAdmin(), d.AdminHandler.AuditLogs)
	// 创作者大赛审核与结算
	adminGroup.GET("/contest", d.ContestHandler.AdminList)
	adminGroup.POST("/contest/:id/review", d.ContestHandler.Review)
	adminGroup.POST("/contest/:id/featured", d.ContestHandler.Feature)
	adminGroup.POST("/contest/:id/settle", d.ContestHandler.Settle)
}
