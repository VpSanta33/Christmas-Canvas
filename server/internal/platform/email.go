package platform

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/basketikun/infinite-canvas/server/internal/mailer"
)

type EmailSettings struct {
	Enabled   bool
	Host      string
	Port      int
	Mode      string
	Username  string
	Password  string
	FromEmail string
	FromName  string
}

type AdminEmailSettings struct {
	Enabled            bool   `json:"enabled"`
	Host               string `json:"host"`
	Port               int    `json:"port"`
	Mode               string `json:"mode"`
	Username           string `json:"username"`
	PasswordConfigured bool   `json:"passwordConfigured"`
	FromEmail          string `json:"fromEmail"`
	FromName           string `json:"fromName"`
}

type EmailSettingsUpdate struct {
	Enabled   bool   `json:"enabled"`
	Host      string `json:"host"`
	Port      int    `json:"port"`
	Mode      string `json:"mode"`
	Username  string `json:"username"`
	Password  string `json:"password"`
	FromEmail string `json:"fromEmail"`
	FromName  string `json:"fromName"`
}

func (s *Store) GetEmailSettings(ctx context.Context) (EmailSettings, error) {
	settings := s.emailDefaults
	var configured bool
	var passwordCipher []byte
	err := s.pool.QueryRow(ctx,
		`SELECT email_configured, email_verification_enabled, smtp_host, smtp_port,
		        smtp_mode, smtp_username, smtp_password_cipher, smtp_from_email, smtp_from_name
		 FROM platform_settings WHERE id=1`,
	).Scan(&configured, &settings.Enabled, &settings.Host, &settings.Port, &settings.Mode,
		&settings.Username, &passwordCipher, &settings.FromEmail, &settings.FromName)
	if err != nil {
		return EmailSettings{}, err
	}
	if !configured {
		return normalizeEmailSettings(s.emailDefaults), nil
	}
	if len(passwordCipher) > 0 {
		plain, err := s.cipher.Decrypt(passwordCipher)
		if err != nil {
			return EmailSettings{}, fmt.Errorf("decrypt smtp password: %w", err)
		}
		settings.Password = string(plain)
	} else {
		settings.Password = ""
	}
	return normalizeEmailSettings(settings), nil
}

func (s *Store) AdminEmailSettings(ctx context.Context) (AdminEmailSettings, error) {
	settings, err := s.GetEmailSettings(ctx)
	if err != nil {
		return AdminEmailSettings{}, err
	}
	return AdminEmailSettings{
		Enabled: settings.Enabled, Host: settings.Host, Port: settings.Port, Mode: settings.Mode,
		Username: settings.Username, PasswordConfigured: settings.Password != "",
		FromEmail: settings.FromEmail, FromName: settings.FromName,
	}, nil
}

func (s *Store) UpdateEmailSettings(ctx context.Context, update EmailSettingsUpdate) error {
	current, err := s.GetEmailSettings(ctx)
	if err != nil {
		return err
	}
	settings := normalizeEmailSettings(EmailSettings{
		Enabled: update.Enabled, Host: update.Host, Port: update.Port, Mode: update.Mode,
		Username: update.Username, Password: current.Password,
		FromEmail: update.FromEmail, FromName: update.FromName,
	})
	if update.Password != "" {
		settings.Password = update.Password
	}
	if settings.Enabled {
		if _, err := smtpFromSettings(settings); err != nil {
			return err
		}
	}
	var passwordCipher []byte
	if settings.Password != "" {
		passwordCipher, err = s.cipher.Encrypt([]byte(settings.Password))
		if err != nil {
			return err
		}
	}
	_, err = s.pool.Exec(ctx,
		`UPDATE platform_settings SET
		 email_configured=true, email_verification_enabled=$1, smtp_host=$2, smtp_port=$3,
		 smtp_mode=$4, smtp_username=$5, smtp_password_cipher=$6,
		 smtp_from_email=$7, smtp_from_name=$8, updated_at=now() WHERE id=1`,
		settings.Enabled, settings.Host, settings.Port, settings.Mode, settings.Username,
		passwordCipher, settings.FromEmail, settings.FromName,
	)
	return err
}

func (s *Store) EmailVerificationEnabled(ctx context.Context) (bool, error) {
	var configured, enabled bool
	if err := s.pool.QueryRow(ctx,
		`SELECT email_configured, email_verification_enabled FROM platform_settings WHERE id=1`,
	).Scan(&configured, &enabled); err != nil {
		return false, err
	}
	if !configured {
		return s.emailDefaults.Enabled, nil
	}
	return enabled, nil
}

func (s *Store) SendVerificationCode(ctx context.Context, to, code string, ttl time.Duration) error {
	settings, err := s.GetEmailSettings(ctx)
	if err != nil {
		return err
	}
	if !settings.Enabled {
		return errors.New("email verification disabled")
	}
	sender, err := smtpFromSettings(settings)
	if err != nil {
		return err
	}
	return sender.SendVerificationCode(ctx, to, code, ttl)
}

func (s *Store) SendTestEmail(ctx context.Context, to string) error {
	settings, err := s.GetEmailSettings(ctx)
	if err != nil {
		return err
	}
	sender, err := smtpFromSettings(settings)
	if err != nil {
		return err
	}
	return sender.SendTestEmail(ctx, to)
}

func normalizeEmailSettings(settings EmailSettings) EmailSettings {
	settings.Host = strings.TrimSpace(settings.Host)
	settings.Mode = strings.ToLower(strings.TrimSpace(settings.Mode))
	settings.Username = strings.TrimSpace(settings.Username)
	settings.FromEmail = strings.TrimSpace(settings.FromEmail)
	settings.FromName = strings.TrimSpace(settings.FromName)
	if settings.Port <= 0 {
		settings.Port = 587
	}
	if settings.Mode == "" {
		settings.Mode = "starttls"
	}
	if settings.FromName == "" {
		settings.FromName = "圣诞画布"
	}
	return settings
}

func smtpFromSettings(settings EmailSettings) (*mailer.SMTPMailer, error) {
	return mailer.NewSMTP(mailer.SMTPOptions{
		Host: settings.Host, Port: settings.Port, Mode: settings.Mode,
		Username: settings.Username, Password: settings.Password,
		FromEmail: settings.FromEmail, FromName: settings.FromName, AppName: settings.FromName,
	})
}
