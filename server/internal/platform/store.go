// Package platform 提供可动态维护的平台公开设置。
package platform

import (
	"context"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/basketikun/infinite-canvas/server/internal/storage"
)

type Settings struct {
	SiteName             string `json:"siteName"`
	LogoURL              string `json:"logoUrl"`
	AllowRegistration    bool   `json:"allowRegistration"`
	RegisterGrantCredits int64  `json:"registerGrantCredits"`
	Announcement         string `json:"announcement"`
	MaintenanceEnabled   bool   `json:"maintenanceEnabled"`
	MaintenanceNotice    string `json:"maintenanceNotice"`
	AutoPauseEnabled     bool   `json:"autoPauseEnabled"`
	AutoPauseFailures    int    `json:"autoPauseFailures"`
}

// SiteSettings 是站点设置页可维护的字段，不包含公告和邮箱配置，
// 避免不同后台页面保存旧快照时互相覆盖。
type SiteSettings struct {
	SiteName             string `json:"siteName"`
	LogoURL              string `json:"logoUrl"`
	AllowRegistration    bool   `json:"allowRegistration"`
	RegisterGrantCredits int64  `json:"registerGrantCredits"`
	AutoPauseEnabled     bool   `json:"autoPauseEnabled"`
	AutoPauseFailures    int    `json:"autoPauseFailures"`
}

type AnnouncementSettings struct {
	Announcement       string `json:"announcement"`
	MaintenanceEnabled bool   `json:"maintenanceEnabled"`
	MaintenanceNotice  string `json:"maintenanceNotice"`
}

type PublicSettings struct {
	SiteName                  string `json:"siteName"`
	LogoURL                   string `json:"logoUrl"`
	AllowRegistration         bool   `json:"allowRegistration"`
	RegisterGrantCredits      int64  `json:"registerGrantCredits"`
	Announcement              string `json:"announcement"`
	MaintenanceEnabled        bool   `json:"maintenanceEnabled"`
	MaintenanceNotice         string `json:"maintenanceNotice"`
	EmailVerificationRequired bool   `json:"emailVerificationRequired"`
}

type Store struct {
	pool          *pgxpool.Pool
	cipher        *storage.Cipher
	defaults      Settings
	emailDefaults EmailSettings
}

func NewStore(pool *pgxpool.Pool, cipher *storage.Cipher, allowRegistration bool, registerGrantCredits int64, emailDefaults EmailSettings) *Store {
	return &Store{
		pool: pool, cipher: cipher, emailDefaults: emailDefaults,
		defaults: Settings{
			SiteName:             "圣诞画布",
			LogoURL:              "/logo.svg",
			AllowRegistration:    allowRegistration,
			RegisterGrantCredits: registerGrantCredits,
			AutoPauseEnabled:     true,
			AutoPauseFailures:    5,
		},
	}
}

func (s *Store) Get(ctx context.Context) (Settings, error) {
	settings := s.defaults
	var configured bool
	err := s.pool.QueryRow(ctx,
		`SELECT site_name, logo_url, allow_registration, register_grant_credits,
		        announcement, maintenance_enabled, maintenance_notice,
		        auto_pause_enabled, auto_pause_failures, configured
		 FROM platform_settings WHERE id = 1`).Scan(
		&settings.SiteName, &settings.LogoURL, &settings.AllowRegistration, &settings.RegisterGrantCredits,
		&settings.Announcement, &settings.MaintenanceEnabled, &settings.MaintenanceNotice,
		&settings.AutoPauseEnabled, &settings.AutoPauseFailures, &configured,
	)
	if err == nil && !configured {
		return s.defaults, nil
	}
	return settings, err
}

func (s *Store) Public(ctx context.Context) (PublicSettings, error) {
	settings, err := s.Get(ctx)
	if err != nil {
		return PublicSettings{}, err
	}
	return PublicSettings{
		SiteName: settings.SiteName, LogoURL: settings.LogoURL,
		AllowRegistration: settings.AllowRegistration, RegisterGrantCredits: settings.RegisterGrantCredits,
		Announcement: settings.Announcement, MaintenanceEnabled: settings.MaintenanceEnabled,
		MaintenanceNotice: settings.MaintenanceNotice,
	}, nil
}

func (s *Store) HasUsers(ctx context.Context) (bool, error) {
	var hasUsers bool
	err := s.pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM users)`).Scan(&hasUsers)
	return hasUsers, err
}

func (s *Store) Site(ctx context.Context) (SiteSettings, error) {
	settings, err := s.Get(ctx)
	if err != nil {
		return SiteSettings{}, err
	}
	return SiteSettings{
		SiteName: settings.SiteName, LogoURL: settings.LogoURL,
		AllowRegistration: settings.AllowRegistration, RegisterGrantCredits: settings.RegisterGrantCredits,
		AutoPauseEnabled: settings.AutoPauseEnabled, AutoPauseFailures: settings.AutoPauseFailures,
	}, nil
}

func (s *Store) Announcements(ctx context.Context) (AnnouncementSettings, error) {
	settings, err := s.Get(ctx)
	if err != nil {
		return AnnouncementSettings{}, err
	}
	return AnnouncementSettings{
		Announcement: settings.Announcement, MaintenanceEnabled: settings.MaintenanceEnabled,
		MaintenanceNotice: settings.MaintenanceNotice,
	}, nil
}

func (s *Store) UpdateSite(ctx context.Context, settings SiteSettings) error {
	settings = normalizeSiteSettings(settings)
	_, err := s.pool.Exec(ctx,
		`UPDATE platform_settings SET
		    site_name = $1, logo_url = $2, allow_registration = $3,
		    register_grant_credits = $4, auto_pause_enabled = $5,
		    auto_pause_failures = $6, configured = true, updated_at = now()
		 WHERE id = 1`,
		settings.SiteName, settings.LogoURL, settings.AllowRegistration,
		settings.RegisterGrantCredits, settings.AutoPauseEnabled, settings.AutoPauseFailures,
	)
	return err
}

func (s *Store) UpdateAnnouncements(ctx context.Context, settings AnnouncementSettings) error {
	settings = normalizeAnnouncementSettings(settings)
	defaults := normalizeSiteSettings(SiteSettings{
		SiteName: s.defaults.SiteName, LogoURL: s.defaults.LogoURL,
		AllowRegistration: s.defaults.AllowRegistration, RegisterGrantCredits: s.defaults.RegisterGrantCredits,
		AutoPauseEnabled: s.defaults.AutoPauseEnabled, AutoPauseFailures: s.defaults.AutoPauseFailures,
	})
	// platform_settings 的初始行可能还未被站点设置页保存。首次只保存公告时，
	// 一并固化环境变量中的站点默认值，避免 configured=true 后回落到 SQL 默认值。
	_, err := s.pool.Exec(ctx,
		`UPDATE platform_settings SET
		    site_name = CASE WHEN configured THEN site_name ELSE $4 END,
		    logo_url = CASE WHEN configured THEN logo_url ELSE $5 END,
		    allow_registration = CASE WHEN configured THEN allow_registration ELSE $6 END,
		    register_grant_credits = CASE WHEN configured THEN register_grant_credits ELSE $7 END,
		    auto_pause_enabled = CASE WHEN configured THEN auto_pause_enabled ELSE $8 END,
		    auto_pause_failures = CASE WHEN configured THEN auto_pause_failures ELSE $9 END,
		    announcement = $1, maintenance_enabled = $2, maintenance_notice = $3,
		    configured = true, updated_at = now()
		 WHERE id = 1`,
		settings.Announcement, settings.MaintenanceEnabled, settings.MaintenanceNotice,
		defaults.SiteName, defaults.LogoURL, defaults.AllowRegistration,
		defaults.RegisterGrantCredits, defaults.AutoPauseEnabled, defaults.AutoPauseFailures,
	)
	return err
}

func (s *Store) Update(ctx context.Context, settings Settings) error {
	settings = normalizeSettings(settings)
	_, err := s.pool.Exec(ctx,
		`INSERT INTO platform_settings (
		    id, site_name, logo_url, allow_registration, register_grant_credits,
		    announcement, maintenance_enabled, maintenance_notice,
		    auto_pause_enabled, auto_pause_failures, configured, updated_at
		 ) VALUES (1, $1, $2, $3, $4, $5, $6, $7, $8, $9, true, now())
		 ON CONFLICT (id) DO UPDATE SET
		    site_name = EXCLUDED.site_name, logo_url = EXCLUDED.logo_url,
		    allow_registration = EXCLUDED.allow_registration,
		    register_grant_credits = EXCLUDED.register_grant_credits,
		    announcement = EXCLUDED.announcement,
		    maintenance_enabled = EXCLUDED.maintenance_enabled,
		    maintenance_notice = EXCLUDED.maintenance_notice,
		    auto_pause_enabled = EXCLUDED.auto_pause_enabled,
		    auto_pause_failures = EXCLUDED.auto_pause_failures,
		    configured = true,
		    updated_at = now()`,
		settings.SiteName, settings.LogoURL, settings.AllowRegistration, settings.RegisterGrantCredits,
		settings.Announcement, settings.MaintenanceEnabled, settings.MaintenanceNotice,
		settings.AutoPauseEnabled, settings.AutoPauseFailures,
	)
	return err
}

// RegistrationPolicy 实现 auth.RegistrationPolicy。
func (s *Store) RegistrationPolicy(ctx context.Context) (bool, int64, error) {
	settings, err := s.Get(ctx)
	return settings.AllowRegistration, settings.RegisterGrantCredits, err
}

func (s *Store) AutoPausePolicy(ctx context.Context) (bool, int, error) {
	settings, err := s.Get(ctx)
	return settings.AutoPauseEnabled, settings.AutoPauseFailures, err
}

func normalizeSettings(settings Settings) Settings {
	site := normalizeSiteSettings(SiteSettings{
		SiteName: settings.SiteName, LogoURL: settings.LogoURL,
		AllowRegistration: settings.AllowRegistration, RegisterGrantCredits: settings.RegisterGrantCredits,
		AutoPauseEnabled: settings.AutoPauseEnabled, AutoPauseFailures: settings.AutoPauseFailures,
	})
	announcement := normalizeAnnouncementSettings(AnnouncementSettings{
		Announcement: settings.Announcement, MaintenanceEnabled: settings.MaintenanceEnabled,
		MaintenanceNotice: settings.MaintenanceNotice,
	})
	settings.SiteName, settings.LogoURL = site.SiteName, site.LogoURL
	settings.AllowRegistration, settings.RegisterGrantCredits = site.AllowRegistration, site.RegisterGrantCredits
	settings.AutoPauseEnabled, settings.AutoPauseFailures = site.AutoPauseEnabled, site.AutoPauseFailures
	settings.Announcement, settings.MaintenanceEnabled = announcement.Announcement, announcement.MaintenanceEnabled
	settings.MaintenanceNotice = announcement.MaintenanceNotice
	return settings
}

func normalizeSiteSettings(settings SiteSettings) SiteSettings {
	settings.SiteName = strings.TrimSpace(settings.SiteName)
	if settings.SiteName == "" {
		settings.SiteName = "圣诞画布"
	}
	settings.LogoURL = strings.TrimSpace(settings.LogoURL)
	if settings.LogoURL == "" {
		settings.LogoURL = "/logo.svg"
	}
	if settings.RegisterGrantCredits < 0 {
		settings.RegisterGrantCredits = 0
	}
	if settings.RegisterGrantCredits > 1_000_000_000 {
		settings.RegisterGrantCredits = 1_000_000_000
	}
	if settings.AutoPauseFailures < 2 {
		settings.AutoPauseFailures = 2
	}
	if settings.AutoPauseFailures > 20 {
		settings.AutoPauseFailures = 20
	}
	return settings
}

func normalizeAnnouncementSettings(settings AnnouncementSettings) AnnouncementSettings {
	settings.Announcement = truncate(strings.TrimSpace(settings.Announcement), 2000)
	settings.MaintenanceNotice = truncate(strings.TrimSpace(settings.MaintenanceNotice), 2000)
	return settings
}

func truncate(value string, max int) string {
	if len(value) <= max {
		return value
	}
	return value[:max]
}
