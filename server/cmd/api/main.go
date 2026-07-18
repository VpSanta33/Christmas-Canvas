// Command api 是 Infinite Canvas 的 Golang 后端入口。
package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	_ "github.com/joho/godotenv/autoload" // 自动加载工作目录下的 .env
	"github.com/redis/go-redis/v9"

	"github.com/basketikun/infinite-canvas/server/internal/admin"
	"github.com/basketikun/infinite-canvas/server/internal/asset"
	"github.com/basketikun/infinite-canvas/server/internal/auth"
	"github.com/basketikun/infinite-canvas/server/internal/canvas"
	"github.com/basketikun/infinite-canvas/server/internal/config"
	"github.com/basketikun/infinite-canvas/server/internal/contest"
	"github.com/basketikun/infinite-canvas/server/internal/credits"
	"github.com/basketikun/infinite-canvas/server/internal/db"
	filepkg "github.com/basketikun/infinite-canvas/server/internal/file"
	"github.com/basketikun/infinite-canvas/server/internal/platform"
	"github.com/basketikun/infinite-canvas/server/internal/proxy"
	"github.com/basketikun/infinite-canvas/server/internal/quota"
	"github.com/basketikun/infinite-canvas/server/internal/router"
	"github.com/basketikun/infinite-canvas/server/internal/storage"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("config: %v", err)
	}

	ctx := context.Background()

	if err := db.Migrate(cfg.DatabaseURL); err != nil {
		log.Fatalf("migrate: %v", err)
	}
	pool, err := db.Connect(ctx, cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("db connect: %v", err)
	}
	defer pool.Close()

	cipher, err := storage.NewCipher(cfg.ChannelEncKey)
	if err != nil {
		log.Fatalf("cipher: %v", err)
	}
	storageManager, err := storage.NewManager(ctx, pool, cipher, storage.RuntimeDefaults{
		Enabled: cfg.StorageEnabled, Provider: "minio", Endpoint: cfg.S3Endpoint,
		AccessKey: cfg.S3AccessKey, SecretKey: cfg.S3SecretKey, Bucket: cfg.S3Bucket,
		Region: cfg.S3Region, UseSSL: cfg.S3UseSSL, PublicBaseURL: cfg.PublicFileBaseURL,
		PathPrefix: cfg.S3PathPrefix, ImagePathPrefix: cfg.S3ImagePathPrefix,
		VideoPathPrefix: cfg.S3VideoPathPrefix,
	})
	if err != nil {
		log.Fatalf("storage manager: %v", err)
	}
	if storageErr := storageManager.LastError(); storageErr != "" {
		log.Printf("warning: object storage unavailable (%s); configure it in admin storage settings", storageErr)
	} else if !storageManager.Available() {
		log.Printf("warning: object storage disabled; media upload endpoints will return 503")
	}

	rdb := redis.NewClient(&redis.Options{
		Addr:     cfg.RedisAddr,
		Password: cfg.RedisPassword,
		DB:       cfg.RedisDB,
	})
	if err := rdb.Ping(ctx).Err(); err != nil {
		log.Printf("warning: redis unavailable (%v); rate limiting will fail-open", err)
	}

	authMgr := auth.NewManager(cfg.JWTSecret, cfg.AccessTTL, cfg.RefreshTTL)
	userStore := auth.NewStore(pool)
	platformStore := platform.NewStore(pool, cipher, cfg.AllowRegistration, cfg.RegisterGrantCredits, platform.EmailSettings{
		Enabled: cfg.EmailVerificationEnabled, Host: cfg.SMTPHost, Port: cfg.SMTPPort,
		Mode: cfg.SMTPMode, Username: cfg.SMTPUsername, Password: cfg.SMTPPassword,
		FromEmail: cfg.SMTPFromEmail, FromName: cfg.SMTPFromName,
	})
	channelStore := proxy.NewChannelStore(pool, cipher)
	quotaSvc := quota.NewService(pool, rdb)
	quotaSvc.SetAutoPausePolicy(platformStore)
	creditsSvc := credits.NewService(pool)

	authHandler := auth.NewHandler(userStore, authMgr, cfg.AllowRegistration, cfg.RegisterGrantCredits, creditsSvc)
	authHandler.SetRegistrationPolicy(platformStore)
	authHandler.SetLoginGuard(auth.NewLoginGuard(rdb))
	platformHandler := platform.NewHandler(platformStore)
	authHandler.SetEmailVerification(platformStore, platformStore, auth.EmailVerificationOptions{
		Enabled: cfg.EmailVerificationEnabled, Secret: cfg.JWTSecret,
		CodeTTL: cfg.EmailVerificationTTL, ResendCooldown: cfg.EmailVerificationCooldown,
		MaxAttempts: 5, MaxSendsHour: 5,
	})
	canvasHandler := canvas.NewHandler(pool)
	assetHandler := asset.NewHandler(pool)
	fileHandler := filepkg.NewHandler(pool, storageManager)
	proxyHandler := proxy.NewHandler(channelStore, usageRecorder{quotaSvc}, creditsSvc)
	channelAdmin := proxy.NewAdminHandler(channelStore)
	adminHandler := admin.NewHandler(pool, userStore, creditsSvc, storageManager)
	storageAdmin := storage.NewAdminHandler(storageManager)
	creditsHandler := credits.NewHandler(creditsSvc)
	contestHandler := contest.NewHandler(pool, storageManager, creditsSvc)

	deps := router.Deps{
		Cfg:             cfg,
		AuthMgr:         authMgr,
		AuthHandler:     authHandler,
		CanvasHandler:   canvasHandler,
		AssetHandler:    assetHandler,
		FileHandler:     fileHandler,
		ProxyHandler:    proxyHandler,
		ChannelAdmin:    channelAdmin,
		AdminHandler:    adminHandler,
		StorageAdmin:    storageAdmin,
		CreditsHandler:  creditsHandler,
		ContestHandler:  contestHandler,
		QuotaSvc:        quotaSvc,
		UserStore:       userStore,
		PlatformHandler: platformHandler,
		Pool:            pool,
	}
	r := router.New(deps)

	srv := &http.Server{
		Addr:              cfg.Addr,
		Handler:           r,
		ReadHeaderTimeout: 10 * time.Second,
	}

	// 独立 goroutine 启动，主 goroutine 等待中断信号后优雅关停，
	// 让进行中的上传 / SSE 转发有时间收尾，避免 SIGTERM 直接掐断连接。
	go func() {
		log.Printf("listening on %s", cfg.Addr)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("server: %v", err)
		}
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit
	log.Println("shutting down...")

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	if err := srv.Shutdown(shutdownCtx); err != nil {
		log.Printf("graceful shutdown failed: %v", err)
	}
	log.Println("server stopped")
}

// usageRecorder 把 quota.Service 适配成 proxy.UsageRecorder：两个包各自定义
// UsageEvent（避免 quota 反向依赖 proxy），此处做字段搬运。
type usageRecorder struct{ svc *quota.Service }

func (u usageRecorder) Record(ctx context.Context, ev proxy.UsageEvent) {
	u.svc.Record(ctx, quota.UsageEvent{
		UserID:       ev.UserID,
		Capability:   ev.Capability,
		ChannelID:    ev.ChannelID,
		Model:        ev.Model,
		Status:       ev.Status,
		HTTPStatus:   ev.HTTPStatus,
		ErrorMessage: ev.ErrorMessage,
		RequestID:    ev.RequestID,
		LatencyMs:    ev.LatencyMs,
		Credits:      ev.Credits,
		Refunded:     ev.Refunded,
	})
}
