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
	filepkg "github.com/basketikun/infinite-canvas/server/internal/file"
	"github.com/basketikun/infinite-canvas/server/internal/middleware"
	"github.com/basketikun/infinite-canvas/server/internal/platform"
	"github.com/basketikun/infinite-canvas/server/internal/quota"
	"github.com/basketikun/infinite-canvas/server/internal/storage"
	"github.com/basketikun/infinite-canvas/server/internal/workspace"
)

// Deps 汇集 New 所需的全部依赖，避免超长参数列表。字段导出以便 cmd/api 装配。
type Deps struct {
	Cfg              *config.Config
	AuthMgr          *auth.Manager
	AuthHandler      *auth.Handler
	CanvasHandler    *canvas.Handler
	AssetHandler     *asset.Handler
	FileHandler      *filepkg.Handler
	AdminHandler     *admin.Handler
	StorageAdmin     *storage.AdminHandler
	WorkspaceHandler *workspace.Handler
	QuotaSvc         *quota.Service
	UserStore        *auth.Store
	PlatformHandler  *platform.Handler
	Pool             *pgxpool.Pool
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
	registerAdminRoutes(api, d)

	return r
}

// registerPublicRoutes 挂载无需登录的站点信息和分享读取端点。
func registerPublicRoutes(api *gin.RouterGroup, d Deps) {
	api.GET("/platform", d.PlatformHandler.Public)
	api.GET("/shared/:token", d.WorkspaceHandler.GetShared)
	api.GET("/shared/:token/files/:key", d.WorkspaceHandler.GetSharedFile)
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

// registerUserRoutes 挂载登录用户的受保护端点：画布、资产、文件和工作空间。
func registerUserRoutes(api *gin.RouterGroup, d Deps) {
	authed := api.Group("")
	authed.Use(middleware.RequireAuthWithSession(d.AuthMgr, d.UserStore))
	authed.GET("/auth/me", func(c *gin.Context) { d.AuthHandler.Me(c, middleware.UserIDFrom(c)) })
	authed.POST("/auth/logout", func(c *gin.Context) { d.AuthHandler.Logout(c, middleware.UserIDFrom(c)) })

	authed.GET("/projects", d.CanvasHandler.List)
	authed.PUT("/projects", d.CanvasHandler.Replace)
	authed.POST("/projects", d.CanvasHandler.Upsert)
	authed.DELETE("/projects/:id", d.CanvasHandler.Delete)
	// 工作区能力：任务中心、版本、分享、模板、通知和团队空间。
	authed.GET("/tasks", d.WorkspaceHandler.ListTasks)
	authed.POST("/tasks", d.WorkspaceHandler.UpsertTask)
	authed.DELETE("/tasks/:id", d.WorkspaceHandler.DeleteTask)
	authed.GET("/projects/:id/versions", d.WorkspaceHandler.ListVersions)
	authed.POST("/projects/:id/versions", d.WorkspaceHandler.CreateVersion)
	authed.POST("/projects/:id/versions/:versionId/restore", d.WorkspaceHandler.RestoreVersion)
	authed.PUT("/projects/:id/team", d.WorkspaceHandler.SetProjectTeam)
	authed.GET("/projects/:id/shares", d.WorkspaceHandler.ListShares)
	authed.POST("/projects/:id/shares", d.WorkspaceHandler.CreateShare)
	authed.DELETE("/projects/:id/shares/:shareId", d.WorkspaceHandler.DeleteShare)
	authed.POST("/shared/:token/copy", d.WorkspaceHandler.CopyShared)
	authed.GET("/templates", d.WorkspaceHandler.ListTemplates)
	authed.POST("/templates", d.WorkspaceHandler.CreateTemplate)
	authed.POST("/templates/:id/use", d.WorkspaceHandler.UseTemplate)
	authed.DELETE("/templates/:id", d.WorkspaceHandler.DeleteTemplate)
	authed.GET("/notifications", d.WorkspaceHandler.ListNotifications)
	authed.POST("/notifications/:id/read", d.WorkspaceHandler.MarkNotificationRead)
	authed.POST("/notifications/read-all", d.WorkspaceHandler.MarkAllNotificationsRead)
	authed.GET("/teams", d.WorkspaceHandler.ListTeams)
	authed.POST("/teams", d.WorkspaceHandler.CreateTeam)
	authed.GET("/teams/:id/members", d.WorkspaceHandler.ListTeamMembers)
	authed.POST("/teams/:id/members", d.WorkspaceHandler.AddTeamMember)
	authed.DELETE("/teams/:id/members/:userId", d.WorkspaceHandler.RemoveTeamMember)

	authed.GET("/assets", d.AssetHandler.List)
	authed.PUT("/assets", d.AssetHandler.Replace)
	authed.POST("/assets", d.AssetHandler.Upsert)
	authed.DELETE("/assets/:id", d.AssetHandler.Delete)

	authed.POST("/files", d.FileHandler.Upload)
	authed.GET("/files/:key", d.FileHandler.Download)
	authed.DELETE("/files/:key", d.FileHandler.Trash)

}

// registerAdminRoutes 挂载管理后台：用户 / 站点 / 邮箱 / 存储，
// 全部经 RequireAdmin + 审计中间件，敏感写操作再叠加超管与二次确认。
func registerAdminRoutes(api *gin.RouterGroup, d Deps) {
	authed := api.Group("")
	authed.Use(middleware.RequireAuthWithSession(d.AuthMgr, d.UserStore))
	adminGroup := authed.Group("/admin")
	adminGroup.Use(middleware.RequireAdmin(), audit.Middleware(d.Pool))
	// 用户管理
	adminGroup.GET("/users", middleware.RequireSuperAdmin(), d.AdminHandler.ListUsers)
	adminGroup.POST("/users", middleware.RequireSuperAdmin(), d.AdminHandler.CreateUser)
	adminGroup.DELETE("/users/:id", middleware.RequireSuperAdmin(), middleware.RequireAdminConfirmation(), d.AdminHandler.DeleteUser)
	adminGroup.POST("/users/:id/role", middleware.RequireSuperAdmin(), middleware.RequireAdminConfirmation(), d.AdminHandler.SetRole)
	adminGroup.POST("/users/:id/disabled", middleware.RequireSuperAdmin(), d.AdminHandler.SetDisabled)
	adminGroup.POST("/users/:id/revoke-sessions", middleware.RequireSuperAdmin(), middleware.RequireAdminConfirmation(), d.AdminHandler.RevokeUserSessions)
	// 用户媒体预览
	adminGroup.GET("/users/:id/media", middleware.RequireSuperAdmin(), d.AdminHandler.UserMedia)
	adminGroup.GET("/users/:id/media/:key", middleware.RequireSuperAdmin(), d.AdminHandler.MediaPreview)
	// 概览
	adminGroup.GET("/overview", d.AdminHandler.Overview)
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
}
