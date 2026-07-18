// Package mailer 提供认证邮件发送能力。SMTP 凭据只来自环境变量，不写入数据库。
package mailer

import (
	"context"
	"crypto/tls"
	"fmt"
	"io"
	"mime"
	"net"
	"net/mail"
	"net/smtp"
	"strconv"
	"strings"
	"time"
)

type SMTPOptions struct {
	Host      string
	Port      int
	Username  string
	Password  string
	FromEmail string
	FromName  string
	AppName   string
	Mode      string // starttls | tls | none
}

type SMTPMailer struct {
	host     string
	address  string
	username string
	password string
	from     mail.Address
	appName  string
	mode     string
}

func NewSMTP(options SMTPOptions) (*SMTPMailer, error) {
	options.Host = strings.TrimSpace(options.Host)
	options.FromEmail = strings.TrimSpace(options.FromEmail)
	options.Mode = strings.ToLower(strings.TrimSpace(options.Mode))
	if options.Host == "" || options.Port <= 0 || options.Port > 65535 {
		return nil, fmt.Errorf("smtp host and port are required")
	}
	parsedFrom, err := mail.ParseAddress(options.FromEmail)
	if err != nil || parsedFrom.Address != options.FromEmail || strings.ContainsAny(options.FromName, "\r\n") {
		return nil, fmt.Errorf("smtp from address is invalid")
	}
	if options.Mode != "starttls" && options.Mode != "tls" && options.Mode != "none" {
		return nil, fmt.Errorf("smtp mode must be starttls, tls, or none")
	}
	if strings.TrimSpace(options.AppName) == "" {
		options.AppName = "圣诞画布"
	}
	if strings.TrimSpace(options.FromName) == "" {
		options.FromName = options.AppName
	}
	return &SMTPMailer{
		host: options.Host, address: net.JoinHostPort(options.Host, strconv.Itoa(options.Port)),
		username: strings.TrimSpace(options.Username), password: options.Password,
		from:    mail.Address{Name: strings.TrimSpace(options.FromName), Address: options.FromEmail},
		appName: strings.TrimSpace(options.AppName), mode: options.Mode,
	}, nil
}

func (m *SMTPMailer) SendVerificationCode(ctx context.Context, to, code string, ttl time.Duration) error {
	recipient, err := mail.ParseAddress(strings.TrimSpace(to))
	if err != nil || recipient.Address != strings.TrimSpace(to) {
		return fmt.Errorf("recipient address is invalid")
	}
	return m.send(ctx, recipient, m.message(recipient, code, ttl))
}

func (m *SMTPMailer) SendTestEmail(ctx context.Context, to string) error {
	recipient, err := mail.ParseAddress(strings.TrimSpace(to))
	if err != nil || recipient.Address != strings.TrimSpace(to) {
		return fmt.Errorf("recipient address is invalid")
	}
	subject := mime.QEncoding.Encode("UTF-8", m.appName+" 邮箱服务测试")
	body := fmt.Sprintf("您好：\r\n\r\n这是一封来自 %s 的 SMTP 测试邮件。\r\n如果您能看到此邮件，说明后台邮箱服务配置可用。\r\n", m.appName)
	message := strings.Join([]string{
		"From: " + m.from.String(), "To: " + recipient.String(), "Subject: " + subject,
		"MIME-Version: 1.0", "Content-Type: text/plain; charset=UTF-8", "Content-Transfer-Encoding: 8bit",
		"Date: " + time.Now().Format(time.RFC1123Z), "", body,
	}, "\r\n")
	return m.send(ctx, recipient, message)
}

func (m *SMTPMailer) send(ctx context.Context, recipient *mail.Address, message string) error {
	client, err := m.connect(ctx)
	if err != nil {
		return err
	}
	defer client.Close()

	if m.username != "" {
		if err := client.Auth(smtp.PlainAuth("", m.username, m.password, m.host)); err != nil {
			return fmt.Errorf("smtp auth: %w", err)
		}
	}
	if err := client.Mail(m.from.Address); err != nil {
		return fmt.Errorf("smtp mail from: %w", err)
	}
	if err := client.Rcpt(recipient.Address); err != nil {
		return fmt.Errorf("smtp recipient: %w", err)
	}
	w, err := client.Data()
	if err != nil {
		return fmt.Errorf("smtp data: %w", err)
	}
	if _, err := io.WriteString(w, message); err != nil {
		_ = w.Close()
		return fmt.Errorf("smtp write: %w", err)
	}
	if err := w.Close(); err != nil {
		return fmt.Errorf("smtp finish data: %w", err)
	}
	if err := client.Quit(); err != nil {
		return fmt.Errorf("smtp quit: %w", err)
	}
	return nil
}

func (m *SMTPMailer) connect(ctx context.Context) (*smtp.Client, error) {
	dialer := &net.Dialer{Timeout: 10 * time.Second}
	conn, err := dialer.DialContext(ctx, "tcp", m.address)
	if err != nil {
		return nil, fmt.Errorf("smtp connect: %w", err)
	}
	_ = conn.SetDeadline(time.Now().Add(20 * time.Second))
	tlsConfig := &tls.Config{ServerName: m.host, MinVersion: tls.VersionTLS12}

	if m.mode == "tls" {
		tlsConn := tls.Client(conn, tlsConfig)
		if err := tlsConn.HandshakeContext(ctx); err != nil {
			_ = conn.Close()
			return nil, fmt.Errorf("smtp tls handshake: %w", err)
		}
		conn = tlsConn
	}
	client, err := smtp.NewClient(conn, m.host)
	if err != nil {
		_ = conn.Close()
		return nil, fmt.Errorf("smtp client: %w", err)
	}
	if m.mode == "starttls" {
		if ok, _ := client.Extension("STARTTLS"); !ok {
			_ = client.Close()
			return nil, fmt.Errorf("smtp server does not advertise STARTTLS")
		}
		if err := client.StartTLS(tlsConfig); err != nil {
			_ = client.Close()
			return nil, fmt.Errorf("smtp starttls: %w", err)
		}
	}
	return client, nil
}

func (m *SMTPMailer) message(to *mail.Address, code string, ttl time.Duration) string {
	minutes := int(ttl.Round(time.Minute) / time.Minute)
	if minutes < 1 {
		minutes = 1
	}
	subject := mime.QEncoding.Encode("UTF-8", m.appName+" 邮箱验证码")
	body := fmt.Sprintf("您好：\r\n\r\n您正在注册 %s。\r\n\r\n邮箱验证码：%s\r\n\r\n验证码将在 %d 分钟后失效。请勿将验证码转发给任何人。\r\n如果不是您本人操作，可以忽略此邮件。\r\n", m.appName, code, minutes)
	return strings.Join([]string{
		"From: " + m.from.String(),
		"To: " + to.String(),
		"Subject: " + subject,
		"MIME-Version: 1.0",
		"Content-Type: text/plain; charset=UTF-8",
		"Content-Transfer-Encoding: 8bit",
		"Date: " + time.Now().Format(time.RFC1123Z),
		"",
		body,
	}, "\r\n")
}
