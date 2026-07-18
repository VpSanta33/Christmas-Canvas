package mailer

import (
	"net/mail"
	"strings"
	"testing"
	"time"
)

func TestSMTPMessageContainsCodeAndSecurityNotice(t *testing.T) {
	m, err := NewSMTP(SMTPOptions{
		Host: "localhost", Port: 1025, FromEmail: "no-reply@example.com",
		FromName: "圣诞画布", AppName: "圣诞画布", Mode: "none",
	})
	if err != nil {
		t.Fatalf("new smtp: %v", err)
	}
	recipient := &mail.Address{Address: "creator@example.com"}
	message := m.message(recipient, "123456", 10*time.Minute)
	for _, expected := range []string{"123456", "10 分钟", "请勿将验证码转发"} {
		if !strings.Contains(message, expected) {
			t.Fatalf("message missing %q", expected)
		}
	}
}
