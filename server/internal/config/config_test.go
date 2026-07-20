package config

import (
	"strings"
	"testing"
	"time"
)

const validEncKey = "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789" // 64 hex = 32 bytes

// setRequiredEnv 设置成功加载所需的必填敏感项（连接串 + 密钥），并关闭对象存储，
// 让不关心 S3 的用例免去逐个设置 S3 凭据。
func setRequiredEnv(t *testing.T) {
	t.Helper()
	t.Setenv("DATABASE_URL", "postgres://user:pass@localhost:5432/db?sslmode=disable")
	t.Setenv("JWT_SECRET", "test-secret-at-least-32-bytes-long")
	t.Setenv("CHANNEL_ENC_KEY", validEncKey)
	t.Setenv("STORAGE_ENABLED", "false")
}

func TestLoadRequiresJWTSecret(t *testing.T) {
	setRequiredEnv(t)
	t.Setenv("JWT_SECRET", "")
	if _, err := Load(); err == nil {
		t.Fatal("expected error when JWT_SECRET is missing")
	}
}

func TestLoadRequiresDatabaseURL(t *testing.T) {
	setRequiredEnv(t)
	t.Setenv("DATABASE_URL", "")
	if _, err := Load(); err == nil {
		t.Fatal("expected error when DATABASE_URL is missing")
	}
}

func TestStorageRequiresS3Credentials(t *testing.T) {
	setRequiredEnv(t)
	t.Setenv("STORAGE_ENABLED", "true")
	t.Setenv("S3_ACCESS_KEY", "")
	t.Setenv("S3_SECRET_KEY", "")
	if _, err := Load(); err == nil {
		t.Fatal("expected error when S3 credentials are missing and storage enabled")
	}
}

func TestStorageDefaultsDisabled(t *testing.T) {
	setRequiredEnv(t)
	t.Setenv("STORAGE_ENABLED", "")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	if cfg.StorageEnabled {
		t.Fatal("expected object storage to be disabled by default")
	}
}

func TestLoadRequiresValidEncKey(t *testing.T) {
	setRequiredEnv(t)
	t.Setenv("CHANNEL_ENC_KEY", "tooshort")
	if _, err := Load(); err == nil {
		t.Fatal("expected error when CHANNEL_ENC_KEY is not 32 bytes")
	}
}

func TestLoadSuccess(t *testing.T) {
	setRequiredEnv(t)
	t.Setenv("ACCESS_TOKEN_TTL", "15m")
	t.Setenv("CORS_ORIGINS", "https://a.com, https://b.com")
	cfg, err := Load()
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	if len(cfg.ChannelEncKey) != 32 {
		t.Errorf("ChannelEncKey len = %d, want 32", len(cfg.ChannelEncKey))
	}
	if cfg.AccessTTL != 15*time.Minute {
		t.Errorf("AccessTTL = %v, want 15m", cfg.AccessTTL)
	}
	if len(cfg.CORSOrigins) != 2 {
		t.Errorf("CORSOrigins = %v, want 2 entries", cfg.CORSOrigins)
	}
}

func TestEmailVerificationRequiresSMTP(t *testing.T) {
	setRequiredEnv(t)
	t.Setenv("EMAIL_VERIFICATION_ENABLED", "true")
	t.Setenv("SMTP_HOST", "")
	t.Setenv("SMTP_FROM_EMAIL", "")
	if _, err := Load(); err == nil {
		t.Fatal("expected SMTP configuration error")
	}
}

func TestEmailVerificationConfig(t *testing.T) {
	setRequiredEnv(t)
	t.Setenv("EMAIL_VERIFICATION_ENABLED", "true")
	t.Setenv("SMTP_HOST", "smtp.example.com")
	t.Setenv("SMTP_FROM_EMAIL", "no-reply@example.com")
	t.Setenv("SMTP_MODE", "tls")
	t.Setenv("SMTP_PORT", "465")
	cfg, err := Load()
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	if !cfg.EmailVerificationEnabled || cfg.SMTPMode != "tls" || cfg.SMTPPort != 465 {
		t.Fatalf("unexpected email config: %#v", cfg)
	}
}

func TestEnvDurationFallback(t *testing.T) {
	t.Setenv("SOME_TTL", "not-a-duration")
	if got := envDuration("SOME_TTL", time.Hour); got != time.Hour {
		t.Errorf("envDuration fallback = %v, want 1h", got)
	}
}

func TestSplitCSVTrimsAndDropsEmpty(t *testing.T) {
	got := splitCSV(" a , ,b,  ")
	if strings.Join(got, ",") != "a,b" {
		t.Errorf("splitCSV = %v, want [a b]", got)
	}
}
