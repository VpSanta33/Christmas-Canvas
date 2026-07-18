// Package config 从环境变量加载运行期配置。
// 所有敏感项（数据库连接串、JWT 密钥、渠道加密密钥、对象存储凭据）只从环境变量读取，
// 绝不硬编码、绝不入库明文；缺失时 Load 直接报错，不回退到内置默认凭据。
package config

import (
	"encoding/hex"
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	// HTTP
	Addr        string
	CORSOrigins []string

	// PostgreSQL
	DatabaseURL string

	// Redis
	RedisAddr     string
	RedisPassword string
	RedisDB       int

	// JWT
	JWTSecret  []byte
	AccessTTL  time.Duration
	RefreshTTL time.Duration

	// 渠道 API Key 加密（AES-256-GCM，32 字节，hex 编码）
	ChannelEncKey []byte

	// MinIO / S3
	S3Endpoint        string
	S3AccessKey       string
	S3SecretKey       string
	S3Bucket          string
	S3UseSSL          bool
	S3Region          string
	S3PathPrefix      string
	S3ImagePathPrefix string
	S3VideoPathPrefix string

	// 是否启用对象存储（关闭后 /files 上传下载返回 503，其余功能正常）
	StorageEnabled bool

	// 公开的文件访问前缀，用于拼接返回给前端的下载 URL（如 https://host/api/files/）
	PublicFileBaseURL string

	// 开放注册开关
	AllowRegistration bool

	// 新用户注册时赠送的初始积分
	RegisterGrantCredits int64

	// 注册邮箱验证与 SMTP。敏感凭据仅从环境变量读取。
	EmailVerificationEnabled  bool
	EmailVerificationTTL      time.Duration
	EmailVerificationCooldown time.Duration
	SMTPHost                  string
	SMTPPort                  int
	SMTPUsername              string
	SMTPPassword              string
	SMTPFromEmail             string
	SMTPFromName              string
	SMTPMode                  string // starttls | tls | none
}

func Load() (*Config, error) {
	cfg := &Config{
		Addr:                     env("APP_ADDR", ":8080"),
		CORSOrigins:              splitCSV(env("CORS_ORIGINS", "*")),
		DatabaseURL:              os.Getenv("DATABASE_URL"),
		RedisAddr:                env("REDIS_ADDR", "localhost:6379"),
		RedisPassword:            env("REDIS_PASSWORD", ""),
		S3Endpoint:               env("S3_ENDPOINT", "localhost:9000"),
		S3AccessKey:              os.Getenv("S3_ACCESS_KEY"),
		S3SecretKey:              os.Getenv("S3_SECRET_KEY"),
		S3Bucket:                 env("S3_BUCKET", "infinite-canvas"),
		S3Region:                 env("S3_REGION", "us-east-1"),
		S3UseSSL:                 envBool("S3_USE_SSL", false),
		S3PathPrefix:             env("STORAGE_PATH_PREFIX", ""),
		S3ImagePathPrefix:        env("STORAGE_IMAGE_PATH_PREFIX", "image"),
		S3VideoPathPrefix:        env("STORAGE_VIDEO_PATH_PREFIX", "Video"),
		StorageEnabled:           envBool("STORAGE_ENABLED", true),
		PublicFileBaseURL:        env("PUBLIC_FILE_BASE_URL", "/api/files/"),
		AllowRegistration:        envBool("ALLOW_REGISTRATION", true),
		EmailVerificationEnabled: envBool("EMAIL_VERIFICATION_ENABLED", false),
		SMTPHost:                 env("SMTP_HOST", ""),
		SMTPUsername:             env("SMTP_USERNAME", ""),
		SMTPPassword:             os.Getenv("SMTP_PASSWORD"),
		SMTPFromEmail:            env("SMTP_FROM_EMAIL", ""),
		SMTPFromName:             env("SMTP_FROM_NAME", "圣诞画布"),
		SMTPMode:                 strings.ToLower(env("SMTP_MODE", "starttls")),
	}

	if cfg.DatabaseURL == "" {
		return nil, fmt.Errorf("DATABASE_URL is required")
	}
	// 启用对象存储时，S3 凭据必填：绝不在源码里保留默认账号密码。
	if cfg.StorageEnabled {
		if cfg.S3AccessKey == "" || cfg.S3SecretKey == "" {
			return nil, fmt.Errorf("S3_ACCESS_KEY and S3_SECRET_KEY are required when STORAGE_ENABLED=true")
		}
	}

	cfg.RegisterGrantCredits = int64(envInt("REGISTER_GRANT_CREDITS", 100))
	cfg.RedisDB = envInt("REDIS_DB", 0)
	cfg.AccessTTL = envDuration("ACCESS_TOKEN_TTL", time.Hour)
	cfg.RefreshTTL = envDuration("REFRESH_TOKEN_TTL", 30*24*time.Hour)
	cfg.EmailVerificationTTL = envDuration("EMAIL_VERIFICATION_TTL", 10*time.Minute)
	cfg.EmailVerificationCooldown = envDuration("EMAIL_VERIFICATION_COOLDOWN", time.Minute)
	cfg.SMTPPort = envInt("SMTP_PORT", 587)

	secret := env("JWT_SECRET", "")
	if secret == "" {
		return nil, fmt.Errorf("JWT_SECRET is required")
	}
	cfg.JWTSecret = []byte(secret)

	encHex := env("CHANNEL_ENC_KEY", "")
	if encHex == "" {
		return nil, fmt.Errorf("CHANNEL_ENC_KEY is required (64 hex chars = 32 bytes)")
	}
	key, err := hex.DecodeString(encHex)
	if err != nil || len(key) != 32 {
		return nil, fmt.Errorf("CHANNEL_ENC_KEY must be 64 hex chars (32 bytes)")
	}
	cfg.ChannelEncKey = key

	if cfg.EmailVerificationEnabled {
		if len(cfg.JWTSecret) < 32 {
			return nil, fmt.Errorf("JWT_SECRET must be at least 32 bytes when email verification is enabled")
		}
		if cfg.SMTPHost == "" || cfg.SMTPFromEmail == "" {
			return nil, fmt.Errorf("SMTP_HOST and SMTP_FROM_EMAIL are required when email verification is enabled")
		}
		if cfg.SMTPPort <= 0 || cfg.SMTPPort > 65535 {
			return nil, fmt.Errorf("SMTP_PORT must be between 1 and 65535")
		}
		if cfg.SMTPMode != "starttls" && cfg.SMTPMode != "tls" && cfg.SMTPMode != "none" {
			return nil, fmt.Errorf("SMTP_MODE must be starttls, tls, or none")
		}
		if cfg.EmailVerificationTTL < time.Minute || cfg.EmailVerificationTTL > time.Hour {
			return nil, fmt.Errorf("EMAIL_VERIFICATION_TTL must be between 1m and 1h")
		}
		if cfg.EmailVerificationCooldown < 10*time.Second || cfg.EmailVerificationCooldown > 10*time.Minute {
			return nil, fmt.Errorf("EMAIL_VERIFICATION_COOLDOWN must be between 10s and 10m")
		}
	}

	return cfg, nil
}

func env(key, fallback string) string {
	if v := strings.TrimSpace(os.Getenv(key)); v != "" {
		return v
	}
	return fallback
}

func envBool(key string, fallback bool) bool {
	v := strings.TrimSpace(os.Getenv(key))
	if v == "" {
		return fallback
	}
	b, err := strconv.ParseBool(v)
	if err != nil {
		return fallback
	}
	return b
}

func envInt(key string, fallback int) int {
	v := strings.TrimSpace(os.Getenv(key))
	if v == "" {
		return fallback
	}
	n, err := strconv.Atoi(v)
	if err != nil {
		return fallback
	}
	return n
}

func envDuration(key string, fallback time.Duration) time.Duration {
	v := strings.TrimSpace(os.Getenv(key))
	if v == "" {
		return fallback
	}
	d, err := time.ParseDuration(v)
	if err != nil {
		return fallback
	}
	return d
}

func splitCSV(s string) []string {
	parts := strings.Split(s, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		if t := strings.TrimSpace(p); t != "" {
			out = append(out, t)
		}
	}
	return out
}
