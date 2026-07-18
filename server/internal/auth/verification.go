package auth

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"fmt"
	"math/big"
	"net/mail"
	"strings"
	"time"
)

const verificationCodeDigits = 6

const (
	minPasswordBytes = 8
	maxPasswordBytes = 72 // bcrypt 只处理前 72 字节，超过时必须拒绝而非静默截断。
)

var (
	ErrVerificationInvalid   = fmt.Errorf("verification code invalid")
	ErrVerificationExpired   = fmt.Errorf("verification code expired")
	ErrVerificationTooMany   = fmt.Errorf("too many verification attempts")
	ErrVerificationCooldown  = fmt.Errorf("verification email sent too recently")
	ErrVerificationSendLimit = fmt.Errorf("verification email hourly limit reached")
)

// VerificationSender 隔离认证逻辑与具体邮件服务，便于测试和替换 SMTP 服务商。
type VerificationSender interface {
	SendVerificationCode(ctx context.Context, to, code string, ttl time.Duration) error
}

type EmailVerificationOptions struct {
	Enabled        bool
	Secret         []byte
	CodeTTL        time.Duration
	ResendCooldown time.Duration
	MaxAttempts    int
	MaxSendsHour   int
}

func (o EmailVerificationOptions) normalized() EmailVerificationOptions {
	if o.CodeTTL <= 0 {
		o.CodeTTL = 10 * time.Minute
	}
	if o.ResendCooldown <= 0 {
		o.ResendCooldown = time.Minute
	}
	if o.MaxAttempts <= 0 {
		o.MaxAttempts = 5
	}
	if o.MaxSendsHour <= 0 {
		o.MaxSendsHour = 5
	}
	return o
}

func generateVerificationCode() (string, error) {
	n, err := rand.Int(rand.Reader, big.NewInt(1_000_000))
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("%0*d", verificationCodeDigits, n.Int64()), nil
}

func generateChallengeToken() (string, error) {
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(raw), nil
}

// hashVerificationCode 使用服务端密钥做 HMAC；即使数据库泄露，六位验证码也不能被离线枚举。
func hashVerificationCode(secret []byte, email, code string) []byte {
	h := hmac.New(sha256.New, secret)
	h.Write([]byte("email-verification\x00"))
	h.Write([]byte(strings.ToLower(strings.TrimSpace(email))))
	h.Write([]byte{'\x00'})
	h.Write([]byte(strings.TrimSpace(code)))
	return h.Sum(nil)
}

func hashChallengeToken(secret []byte, email, token string) []byte {
	h := hmac.New(sha256.New, secret)
	h.Write([]byte("email-challenge\x00"))
	h.Write([]byte(strings.ToLower(strings.TrimSpace(email))))
	h.Write([]byte{'\x00'})
	h.Write([]byte(strings.TrimSpace(token)))
	return h.Sum(nil)
}

func normalizeEmail(raw string) (string, bool) {
	email := strings.ToLower(strings.TrimSpace(raw))
	if email == "" || len(email) > 254 || strings.ContainsAny(email, "\r\n") {
		return "", false
	}
	address, err := mail.ParseAddress(email)
	if err != nil || strings.ToLower(address.Address) != email {
		return "", false
	}
	return email, true
}

func validPassword(password string) bool {
	return passwordStrengthError(password) == ""
}

// passwordStrengthError 校验密码强度：长度 8-72 字节，且至少包含字母与数字两类字符，
// 拒绝纯数字/纯字母等弱口令。返回空串表示通过，否则为面向用户的中文错误文案。
func passwordStrengthError(password string) string {
	if len(password) < minPasswordBytes {
		return "密码长度至少 8 位"
	}
	if len(password) > maxPasswordBytes {
		return "密码长度不能超过 72 位"
	}
	var hasLetter, hasDigit bool
	for _, r := range password {
		switch {
		case r >= '0' && r <= '9':
			hasDigit = true
		case (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z'):
			hasLetter = true
		}
	}
	if !hasLetter || !hasDigit {
		return "密码需同时包含字母和数字"
	}
	return ""
}
