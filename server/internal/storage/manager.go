package storage

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

var (
	ErrStorageDisabled    = errors.New("object storage disabled")
	ErrStorageUnavailable = errors.New("object storage unavailable")
)

// RuntimeDefaults 是环境变量提供的对象存储回退配置。管理员尚未保存后台设置时，
// Manager 会继续使用它，保证现有部署平滑升级。
type RuntimeDefaults struct {
	Enabled            bool
	Provider           string
	Endpoint           string
	AccessKey          string
	SecretKey          string
	Bucket             string
	Region             string
	UseSSL             bool
	PublicBaseURL      string
	PathPrefix         string
	ImagePathPrefix    string
	VideoPathPrefix    string
	TrashRetentionDays int
}

type resolvedSettings struct {
	RuntimeDefaults
	Configured bool
}

// AdminSettings 是可安全返回给后台页面的配置快照，不包含任何密钥明文。
type AdminSettings struct {
	Configured          bool   `json:"configured"`
	Source              string `json:"source"`
	Enabled             bool   `json:"enabled"`
	Provider            string `json:"provider"`
	Endpoint            string `json:"endpoint"`
	Bucket              string `json:"bucket"`
	Region              string `json:"region"`
	UseSSL              bool   `json:"useSSL"`
	PublicBaseURL       string `json:"publicBaseUrl"`
	PathPrefix          string `json:"pathPrefix"`
	ImagePathPrefix     string `json:"imagePathPrefix"`
	VideoPathPrefix     string `json:"videoPathPrefix"`
	TrashRetentionDays  int    `json:"trashRetentionDays"`
	AccessKeyConfigured bool   `json:"accessKeyConfigured"`
	SecretKeyConfigured bool   `json:"secretKeyConfigured"`
	Available           bool   `json:"available"`
	StatusMessage       string `json:"statusMessage"`
}

// SettingsUpdate 中密钥留空表示保留现有值，避免管理接口回显敏感信息。
type SettingsUpdate struct {
	Enabled            bool   `json:"enabled"`
	Provider           string `json:"provider"`
	Endpoint           string `json:"endpoint"`
	Bucket             string `json:"bucket"`
	Region             string `json:"region"`
	UseSSL             bool   `json:"useSSL"`
	PublicBaseURL      string `json:"publicBaseUrl"`
	PathPrefix         string `json:"pathPrefix"`
	ImagePathPrefix    string `json:"imagePathPrefix"`
	VideoPathPrefix    string `json:"videoPathPrefix"`
	TrashRetentionDays int    `json:"trashRetentionDays"`
	AccessKey          string `json:"accessKey"`
	SecretKey          string `json:"secretKey"`
}

// Manager 持有当前可用的对象存储客户端。后台保存配置后原子替换客户端，
// 上传/下载处理器无需重启服务即可使用新配置。
type Manager struct {
	pool     *pgxpool.Pool
	cipher   *Cipher
	defaults resolvedSettings

	mu       sync.RWMutex
	updateMu sync.Mutex
	settings resolvedSettings
	store    *ObjectStore
	lastErr  string
}

func NewManager(ctx context.Context, pool *pgxpool.Pool, cipher *Cipher, defaults RuntimeDefaults) (*Manager, error) {
	normalized, err := normalizeResolved(resolvedSettings{RuntimeDefaults: defaults})
	if err != nil && defaults.Enabled {
		return nil, fmt.Errorf("invalid object storage environment defaults: %w", err)
	}
	if err != nil {
		normalized = resolvedSettings{RuntimeDefaults: RuntimeDefaults{
			Enabled: false, Provider: "s3", Region: "us-east-1", PublicBaseURL: "/api/files/",
			ImagePathPrefix: "image", VideoPathPrefix: "Video", TrashRetentionDays: 7,
		}}
	}
	m := &Manager{pool: pool, cipher: cipher, defaults: normalized, settings: normalized}
	settings, err := m.load(ctx)
	if err != nil {
		return nil, err
	}
	m.settings = settings
	if settings.Enabled {
		if settings.AccessKey == "" || settings.SecretKey == "" {
			if m.lastErr == "" {
				m.lastErr = "对象存储密钥缺失，请在管理员后台重新保存 S3 配置"
			}
		} else {
			store, buildErr := buildObjectStore(ctx, settings)
			if buildErr != nil {
				m.lastErr = buildErr.Error()
			} else {
				m.store = store
			}
		}
	}
	return m, nil
}

func (m *Manager) load(ctx context.Context) (resolvedSettings, error) {
	var settings resolvedSettings
	var accessCipher, secretCipher []byte
	err := m.pool.QueryRow(ctx,
		`SELECT configured, enabled, provider, endpoint, bucket, region, use_ssl,
		        public_base_url, path_prefix, image_path_prefix, video_path_prefix, trash_retention_days,
		        access_key_cipher, secret_key_cipher
		 FROM storage_settings WHERE id=1`,
	).Scan(&settings.Configured, &settings.Enabled, &settings.Provider, &settings.Endpoint,
		&settings.Bucket, &settings.Region, &settings.UseSSL, &settings.PublicBaseURL,
		&settings.PathPrefix, &settings.ImagePathPrefix, &settings.VideoPathPrefix, &settings.TrashRetentionDays,
		&accessCipher, &secretCipher)
	if err != nil {
		return resolvedSettings{}, fmt.Errorf("load storage settings: %w", err)
	}
	if !settings.Configured {
		return m.defaults, nil
	}
	var decryptErr error
	if len(accessCipher) > 0 {
		plain, err := m.cipher.Decrypt(accessCipher)
		if err != nil {
			decryptErr = fmt.Errorf("decrypt storage access key: %w", err)
		} else {
			settings.AccessKey = string(plain)
		}
	}
	if len(secretCipher) > 0 {
		plain, err := m.cipher.Decrypt(secretCipher)
		if err != nil && decryptErr == nil {
			decryptErr = fmt.Errorf("decrypt storage secret key: %w", err)
		} else if err == nil {
			settings.SecretKey = string(plain)
		}
	}
	if decryptErr != nil {
		// 配置密钥更换后，旧的 S3 密钥无法解密。不要让整个 API 进程退出，
		// 先保留非敏感设置并允许管理员重新保存密钥；已有账号和画布仍可访问。
		m.lastErr = decryptErr.Error() + "; 请在管理员后台重新保存 S3 配置"
		return normalizeWithoutCredentialValidation(settings)
	}
	if settings.Enabled && (settings.AccessKey == "" || settings.SecretKey == "") {
		return normalizeWithoutCredentialValidation(settings)
	}
	return normalizeResolved(settings)
}

func normalizeWithoutCredentialValidation(settings resolvedSettings) (resolvedSettings, error) {
	enabled := settings.Enabled
	settings.Enabled = false
	normalized, err := normalizeResolved(settings)
	if err != nil {
		return settings, err
	}
	normalized.Enabled = enabled
	return normalized, nil
}

func (m *Manager) AdminSettings() AdminSettings {
	m.mu.RLock()
	defer m.mu.RUnlock()
	status := "对象存储已关闭"
	if m.settings.Enabled && m.store != nil {
		status = "连接正常，生成媒体将自动写入对象存储"
	} else if m.settings.Enabled && m.lastErr != "" {
		status = m.lastErr
	}
	source := "environment"
	if m.settings.Configured {
		source = "database"
	}
	return AdminSettings{
		Configured: m.settings.Configured, Source: source, Enabled: m.settings.Enabled,
		Provider: m.settings.Provider, Endpoint: m.settings.Endpoint, Bucket: m.settings.Bucket,
		Region: m.settings.Region, UseSSL: m.settings.UseSSL, PublicBaseURL: m.settings.PublicBaseURL,
		PathPrefix: m.settings.PathPrefix, ImagePathPrefix: m.settings.ImagePathPrefix,
		VideoPathPrefix: m.settings.VideoPathPrefix, TrashRetentionDays: m.settings.TrashRetentionDays,
		AccessKeyConfigured: m.settings.AccessKey != "",
		SecretKeyConfigured: m.settings.SecretKey != "", Available: m.store != nil,
		StatusMessage: status,
	}
}

func (m *Manager) LastError() string {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.lastErr
}

func (m *Manager) Available() bool {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.store != nil
}

func (m *Manager) Update(ctx context.Context, update SettingsUpdate) error {
	m.updateMu.Lock()
	defer m.updateMu.Unlock()

	settings, err := m.merged(update)
	if err != nil {
		return err
	}
	var nextStore *ObjectStore
	if settings.Enabled {
		nextStore, err = buildObjectStore(ctx, settings)
		if err != nil {
			return fmt.Errorf("连接对象存储失败: %w", err)
		}
	}
	accessCipher, err := encryptOptional(m.cipher, settings.AccessKey)
	if err != nil {
		return err
	}
	secretCipher, err := encryptOptional(m.cipher, settings.SecretKey)
	if err != nil {
		return err
	}
	_, err = m.pool.Exec(ctx,
		`UPDATE storage_settings SET configured=true, enabled=$1, provider=$2, endpoint=$3,
		 bucket=$4, region=$5, use_ssl=$6, public_base_url=$7, path_prefix=$8,
		 image_path_prefix=$9, video_path_prefix=$10, trash_retention_days=$11,
		 access_key_cipher=$12, secret_key_cipher=$13, updated_at=now() WHERE id=1`,
		settings.Enabled, settings.Provider, settings.Endpoint, settings.Bucket, settings.Region,
		settings.UseSSL, settings.PublicBaseURL, settings.PathPrefix,
		settings.ImagePathPrefix, settings.VideoPathPrefix, settings.TrashRetentionDays,
		accessCipher, secretCipher)
	if err != nil {
		return fmt.Errorf("save storage settings: %w", err)
	}
	settings.Configured = true
	m.mu.Lock()
	m.settings = settings
	m.store = nextStore
	m.lastErr = ""
	m.mu.Unlock()
	return nil
}

// Test 使用表单中的配置现场探测，不保存配置；密钥留空时沿用已保存密钥。
func (m *Manager) Test(ctx context.Context, update SettingsUpdate) error {
	settings, err := m.merged(update)
	if err != nil {
		return err
	}
	settings.Enabled = true
	store, err := buildObjectStore(ctx, settings)
	if err != nil {
		return fmt.Errorf("连接对象存储失败: %w", err)
	}
	probeID := fmt.Sprintf(".infinite-canvas-probe-%d", time.Now().UnixNano())
	for _, kind := range []string{"image", "video"} {
		prefix := storagePrefix(settings, kind)
		key := probeID
		if prefix != "" {
			key = prefix + "/" + probeID
		}
		if err := store.Put(ctx, key, []byte("ok"), "text/plain"); err != nil {
			return fmt.Errorf("测试写入 %s 失败: %w", prefix, err)
		}
		if err := store.Delete(ctx, key); err != nil {
			return fmt.Errorf("测试删除 %s 失败: %w", prefix, err)
		}
	}
	return nil
}

func (m *Manager) merged(update SettingsUpdate) (resolvedSettings, error) {
	m.mu.RLock()
	current := m.settings
	m.mu.RUnlock()
	settings := resolvedSettings{RuntimeDefaults: RuntimeDefaults{
		Enabled: update.Enabled, Provider: update.Provider, Endpoint: update.Endpoint,
		Bucket: update.Bucket, Region: update.Region, UseSSL: update.UseSSL,
		PublicBaseURL: update.PublicBaseURL, PathPrefix: update.PathPrefix,
		ImagePathPrefix: update.ImagePathPrefix, VideoPathPrefix: update.VideoPathPrefix,
		TrashRetentionDays: update.TrashRetentionDays,
		AccessKey:          strings.TrimSpace(update.AccessKey), SecretKey: strings.TrimSpace(update.SecretKey),
	}}
	if settings.AccessKey == "" {
		settings.AccessKey = current.AccessKey
	}
	if settings.SecretKey == "" {
		settings.SecretKey = current.SecretKey
	}
	return normalizeResolved(settings)
}

func normalizeResolved(settings resolvedSettings) (resolvedSettings, error) {
	settings.Provider = strings.ToLower(strings.TrimSpace(settings.Provider))
	if settings.Provider == "" {
		settings.Provider = "s3"
	}
	settings.Endpoint = strings.TrimSpace(settings.Endpoint)
	if strings.Contains(settings.Endpoint, "://") {
		parsed, err := url.Parse(settings.Endpoint)
		if err != nil || parsed.Host == "" {
			return settings, errors.New("Endpoint 格式不正确")
		}
		if parsed.Path != "" && parsed.Path != "/" {
			return settings, errors.New("Endpoint 不能包含路径")
		}
		settings.UseSSL = parsed.Scheme == "https"
		settings.Endpoint = parsed.Host
	}
	settings.Endpoint = strings.TrimRight(settings.Endpoint, "/")
	settings.Bucket = strings.TrimSpace(settings.Bucket)
	settings.Region = strings.TrimSpace(settings.Region)
	if settings.Region == "" {
		settings.Region = "us-east-1"
	}
	settings.PublicBaseURL = strings.TrimSpace(settings.PublicBaseURL)
	if settings.PublicBaseURL == "" {
		settings.PublicBaseURL = "/api/files/"
	}
	settings.PathPrefix = strings.Trim(strings.TrimSpace(settings.PathPrefix), "/")
	settings.ImagePathPrefix = strings.Trim(strings.TrimSpace(settings.ImagePathPrefix), "/")
	settings.VideoPathPrefix = strings.Trim(strings.TrimSpace(settings.VideoPathPrefix), "/")
	if settings.ImagePathPrefix == "" {
		settings.ImagePathPrefix = "image"
	}
	if settings.VideoPathPrefix == "" {
		settings.VideoPathPrefix = "Video"
	}
	if settings.TrashRetentionDays < 1 {
		settings.TrashRetentionDays = 7
	}
	if settings.TrashRetentionDays > 90 {
		settings.TrashRetentionDays = 90
	}
	for _, candidate := range []string{settings.PathPrefix, settings.ImagePathPrefix, settings.VideoPathPrefix} {
		for _, part := range strings.Split(candidate, "/") {
			if part == "." || part == ".." {
				return settings, errors.New("对象路径不能包含 . 或 ..")
			}
		}
	}
	if settings.Enabled {
		switch {
		case settings.Endpoint == "":
			return settings, errors.New("启用对象存储时必须填写 Endpoint")
		case settings.Bucket == "":
			return settings, errors.New("启用对象存储时必须填写 Bucket")
		case settings.AccessKey == "":
			return settings, errors.New("启用对象存储时必须填写 AccessKey ID")
		case settings.SecretKey == "":
			return settings, errors.New("启用对象存储时必须填写 AccessKey Secret")
		}
	}
	return settings, nil
}

func buildObjectStore(ctx context.Context, settings resolvedSettings) (*ObjectStore, error) {
	return NewObjectStore(ctx, ObjectStoreOptions{
		Endpoint: settings.Endpoint, AccessKey: settings.AccessKey, SecretKey: settings.SecretKey,
		Bucket: settings.Bucket, Region: settings.Region, UseSSL: settings.UseSSL,
	})
}

func encryptOptional(cipher *Cipher, value string) ([]byte, error) {
	if value == "" {
		return nil, nil
	}
	return cipher.Encrypt([]byte(value))
}

func (m *Manager) activeStore() (*ObjectStore, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	if !m.settings.Enabled {
		return nil, ErrStorageDisabled
	}
	if m.store == nil {
		if m.lastErr != "" {
			return nil, fmt.Errorf("%w: %s", ErrStorageUnavailable, m.lastErr)
		}
		return nil, ErrStorageUnavailable
	}
	return m.store, nil
}

// Put 自动应用当前路径前缀，并返回应写入 files.object_key 的完整对象键。
func (m *Manager) Put(ctx context.Context, kind, objectKey string, data []byte, contentType string) (string, error) {
	fullKey, _, err := m.PutReader(ctx, kind, objectKey, bytes.NewReader(data), int64(len(data)), contentType)
	return fullKey, err
}

// PutReader 把媒体流直接传给当前对象存储，并返回数据库应保存的完整对象键与字节数。
func (m *Manager) PutReader(ctx context.Context, kind, objectKey string, reader io.Reader, size int64, contentType string) (string, int64, error) {
	m.mu.RLock()
	prefix := storagePrefix(m.settings, kind)
	store := m.store
	enabled := m.settings.Enabled
	lastErr := m.lastErr
	m.mu.RUnlock()
	fullKey := strings.TrimLeft(objectKey, "/")
	if prefix != "" {
		fullKey = prefix + "/" + fullKey
	}
	if !enabled {
		return "", 0, ErrStorageDisabled
	}
	if store == nil {
		if lastErr != "" {
			return "", 0, fmt.Errorf("%w: %s", ErrStorageUnavailable, lastErr)
		}
		return "", 0, ErrStorageUnavailable
	}
	written, err := store.PutReader(ctx, fullKey, reader, size, contentType)
	if err != nil {
		return "", 0, err
	}
	return fullKey, written, nil
}

func storagePrefix(settings resolvedSettings, kind string) string {
	mediaPrefix := ""
	switch kind {
	case "image", "contest-cover":
		mediaPrefix = settings.ImagePathPrefix
	case "video", "video-reference", "contest-video":
		mediaPrefix = settings.VideoPathPrefix
	}
	parts := make([]string, 0, 2)
	if settings.PathPrefix != "" {
		parts = append(parts, settings.PathPrefix)
	}
	if mediaPrefix != "" {
		parts = append(parts, mediaPrefix)
	}
	return strings.Join(parts, "/")
}

func (m *Manager) Get(ctx context.Context, objectKey string) ([]byte, string, error) {
	store, err := m.activeStore()
	if err != nil {
		return nil, "", err
	}
	return store.Get(ctx, objectKey)
}

func (m *Manager) Open(ctx context.Context, objectKey string) (io.ReadCloser, ObjectInfo, error) {
	store, err := m.activeStore()
	if err != nil {
		return nil, ObjectInfo{}, err
	}
	return store.Open(ctx, objectKey)
}

func (m *Manager) Delete(ctx context.Context, objectKey string) error {
	store, err := m.activeStore()
	if err != nil {
		return err
	}
	return store.Delete(ctx, objectKey)
}

func (m *Manager) PublicFileURL(storageKey string) string {
	m.mu.RLock()
	base := m.settings.PublicBaseURL
	m.mu.RUnlock()
	return strings.TrimRight(base, "/") + "/" + url.PathEscape(storageKey)
}
