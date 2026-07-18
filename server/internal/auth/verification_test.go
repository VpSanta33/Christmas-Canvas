package auth

import (
	"bytes"
	"testing"
)

func TestGenerateVerificationCode(t *testing.T) {
	for range 100 {
		code, err := generateVerificationCode()
		if err != nil {
			t.Fatalf("generate code: %v", err)
		}
		if len(code) != verificationCodeDigits {
			t.Fatalf("code length = %d, want %d", len(code), verificationCodeDigits)
		}
		for _, r := range code {
			if r < '0' || r > '9' {
				t.Fatalf("code contains non-digit: %q", code)
			}
		}
	}
}

func TestVerificationHashBindsEmailAndCode(t *testing.T) {
	secret := []byte("test-secret")
	a := hashVerificationCode(secret, "USER@example.com ", "123456")
	b := hashVerificationCode(secret, "user@example.com", "123456")
	if !bytes.Equal(a, b) {
		t.Fatal("normalized email should produce the same hash")
	}
	if bytes.Equal(a, hashVerificationCode(secret, "other@example.com", "123456")) {
		t.Fatal("hash must be bound to email")
	}
	if bytes.Equal(a, hashVerificationCode(secret, "user@example.com", "654321")) {
		t.Fatal("hash must be bound to code")
	}
}

func TestNormalizeEmailRejectsDisplayNameAndHeaderInjection(t *testing.T) {
	if email, ok := normalizeEmail(" Creator@Example.com "); !ok || email != "creator@example.com" {
		t.Fatalf("normalize email = %q, %v", email, ok)
	}
	for _, candidate := range []string{"Creator <creator@example.com>", "a@example.com\r\nBcc:x@example.com", "not-an-email"} {
		if _, ok := normalizeEmail(candidate); ok {
			t.Fatalf("expected email to be rejected: %q", candidate)
		}
	}
}

func TestPasswordLengthMatchesBcryptLimit(t *testing.T) {
	if validPassword("short1") {
		t.Fatal("short password should be rejected")
	}
	if !validPassword("correct-horse-battery-staple-9") {
		t.Fatal("normal password with letters and digits should be accepted")
	}
	if validPassword(string(make([]byte, maxPasswordBytes+1))) {
		t.Fatal("password beyond bcrypt limit should be rejected")
	}
}

func TestPasswordStrengthPolicy(t *testing.T) {
	cases := []struct {
		name     string
		password string
		wantOK   bool
	}{
		{"too short", "ab12", false},
		{"letters only", "abcdefgh", false},
		{"digits only", "12345678", false},
		{"letters and digits", "abcd1234", true},
		{"too long", string(make([]byte, maxPasswordBytes+1)), false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := passwordStrengthError(tc.password) == ""; got != tc.wantOK {
				t.Fatalf("password %q: got ok=%v, want %v (err=%q)", tc.password, got, tc.wantOK, passwordStrengthError(tc.password))
			}
		})
	}
}
