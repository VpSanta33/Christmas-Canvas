// Package auth 处理 JWT 签发/校验与密码哈希。
package auth

import (
	"errors"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/crypto/bcrypt"
)

type Manager struct {
	secret     []byte
	accessTTL  time.Duration
	refreshTTL time.Duration
}

func NewManager(secret []byte, accessTTL, refreshTTL time.Duration) *Manager {
	return &Manager{secret: secret, accessTTL: accessTTL, refreshTTL: refreshTTL}
}

type Claims struct {
	UserID         string `json:"uid"`
	Role           string `json:"role"`
	Type           string `json:"typ"` // access | refresh
	SessionVersion int    `json:"sv"`
	jwt.RegisteredClaims
}

func (m *Manager) issue(userID, role, typ string, sessionVersion int, ttl time.Duration) (string, error) {
	now := time.Now()
	claims := Claims{
		UserID:         userID,
		Role:           role,
		Type:           typ,
		SessionVersion: sessionVersion,
		RegisteredClaims: jwt.RegisteredClaims{
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(now.Add(ttl)),
		},
	}
	return jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString(m.secret)
}

func (m *Manager) IssueAccess(userID, role string) (string, error) {
	return m.IssueAccessForSession(userID, role, 0)
}

func (m *Manager) IssueRefresh(userID, role string) (string, error) {
	return m.IssueRefreshForSession(userID, role, 0)
}

func (m *Manager) IssueAccessForSession(userID, role string, sessionVersion int) (string, error) {
	return m.issue(userID, role, "access", sessionVersion, m.accessTTL)
}

func (m *Manager) IssueRefreshForSession(userID, role string, sessionVersion int) (string, error) {
	return m.issue(userID, role, "refresh", sessionVersion, m.refreshTTL)
}

func (m *Manager) Parse(token string) (*Claims, error) {
	parsed, err := jwt.ParseWithClaims(token, &Claims{}, func(t *jwt.Token) (any, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, errors.New("unexpected signing method")
		}
		return m.secret, nil
	})
	if err != nil {
		return nil, err
	}
	claims, ok := parsed.Claims.(*Claims)
	if !ok || !parsed.Valid {
		return nil, errors.New("invalid token")
	}
	return claims, nil
}

func HashPassword(pw string) (string, error) {
	b, err := bcrypt.GenerateFromPassword([]byte(pw), bcrypt.DefaultCost)
	return string(b), err
}

func CheckPassword(hash, pw string) bool {
	return bcrypt.CompareHashAndPassword([]byte(hash), []byte(pw)) == nil
}
