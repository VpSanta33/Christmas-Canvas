package auth

import (
	"testing"
	"time"
)

func newTestManager() *Manager {
	return NewManager([]byte("test-secret-key-32-bytes-abcdefgh"), time.Hour, 24*time.Hour)
}

func TestIssueAndParseAccess(t *testing.T) {
	m := newTestManager()
	tok, err := m.IssueAccess("user-1", "admin")
	if err != nil {
		t.Fatalf("issue access: %v", err)
	}
	claims, err := m.Parse(tok)
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if claims.UserID != "user-1" {
		t.Errorf("UserID = %q, want user-1", claims.UserID)
	}
	if claims.Role != "admin" {
		t.Errorf("Role = %q, want admin", claims.Role)
	}
	if claims.Type != "access" {
		t.Errorf("Type = %q, want access", claims.Type)
	}
}

func TestIssueRefreshType(t *testing.T) {
	m := newTestManager()
	tok, err := m.IssueRefresh("user-2", "user")
	if err != nil {
		t.Fatalf("issue refresh: %v", err)
	}
	claims, err := m.Parse(tok)
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if claims.Type != "refresh" {
		t.Errorf("Type = %q, want refresh", claims.Type)
	}
}

func TestIssueSessionVersion(t *testing.T) {
	m := newTestManager()
	tok, err := m.IssueAccessForSession("user-session", "operator", 7)
	if err != nil {
		t.Fatalf("issue access: %v", err)
	}
	claims, err := m.Parse(tok)
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if claims.SessionVersion != 7 || claims.Role != "operator" {
		t.Fatalf("claims = %#v, want session version 7 and operator", claims)
	}
}

func TestParseRejectsWrongSecret(t *testing.T) {
	m := newTestManager()
	tok, _ := m.IssueAccess("user-3", "user")
	other := NewManager([]byte("a-completely-different-secret-key"), time.Hour, time.Hour)
	if _, err := other.Parse(tok); err == nil {
		t.Fatal("expected parse to fail with wrong secret")
	}
}

func TestParseRejectsExpired(t *testing.T) {
	m := NewManager([]byte("test-secret-key-32-bytes-abcdefgh"), -time.Minute, time.Hour)
	tok, _ := m.IssueAccess("user-4", "user")
	if _, err := m.Parse(tok); err == nil {
		t.Fatal("expected parse to fail for expired token")
	}
}

func TestParseRejectsGarbage(t *testing.T) {
	m := newTestManager()
	if _, err := m.Parse("not-a-jwt"); err == nil {
		t.Fatal("expected parse to fail on garbage token")
	}
}

func TestPasswordHashing(t *testing.T) {
	hash, err := HashPassword("s3cr3t-pass")
	if err != nil {
		t.Fatalf("hash: %v", err)
	}
	if hash == "s3cr3t-pass" {
		t.Fatal("hash must not equal plaintext")
	}
	if !CheckPassword(hash, "s3cr3t-pass") {
		t.Error("CheckPassword should accept the correct password")
	}
	if CheckPassword(hash, "wrong-pass") {
		t.Error("CheckPassword should reject a wrong password")
	}
}
