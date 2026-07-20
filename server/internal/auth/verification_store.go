package auth

import (
	"context"
	"crypto/subtle"
	"errors"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

// CreateRegistrationChallenge 保存与当前浏览器 challenge token 绑定的待验证注册。
// 同邮箱的新注册会替换旧 challenge，但旧浏览器 token 随即失效，不会激活他人设置的密码。
func (s *Store) CreateRegistrationChallenge(ctx context.Context, email, passwordHash, displayName string, codeHash, challengeHash []byte, ttl, cooldown time.Duration, maxSendsHour int) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	email = strings.ToLower(strings.TrimSpace(email))
	if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, email); err != nil {
		return err
	}
	var exists bool
	if err := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM users WHERE email=$1)`, email).Scan(&exists); err != nil {
		return err
	}
	if exists {
		return ErrEmailTaken
	}
	now := time.Now()
	var lastSent, windowStart time.Time
	var sendCount int
	err = tx.QueryRow(ctx,
		`SELECT last_sent_at, send_window_start, send_count
		 FROM email_verification_challenges WHERE email=$1 FOR UPDATE`, email,
	).Scan(&lastSent, &windowStart, &sendCount)
	if errors.Is(err, pgx.ErrNoRows) {
		_, err = tx.Exec(ctx,
			`INSERT INTO email_verification_challenges
			 (email, password_hash, display_name, code_hash, challenge_hash, expires_at,
			  attempts, last_sent_at, send_window_start, send_count)
			 VALUES ($1,$2,$3,$4,$5,$6,0,$7,$7,1)`,
			email, passwordHash, displayName, codeHash, challengeHash, now.Add(ttl), now,
		)
		if err != nil {
			return err
		}
		return tx.Commit(ctx)
	}
	if err != nil {
		return err
	}
	if now.Before(lastSent.Add(cooldown)) {
		return ErrVerificationCooldown
	}
	if now.Sub(windowStart) >= time.Hour {
		windowStart, sendCount = now, 0
	}
	if sendCount >= maxSendsHour {
		return ErrVerificationSendLimit
	}
	_, err = tx.Exec(ctx,
		`UPDATE email_verification_challenges
		 SET password_hash=$2, display_name=$3, code_hash=$4, challenge_hash=$5,
		     expires_at=$6, attempts=0, last_sent_at=$7, send_window_start=$8, send_count=$9
		 WHERE email=$1`,
		email, passwordHash, displayName, codeHash, challengeHash, now.Add(ttl), now, windowStart, sendCount+1,
	)
	if err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (s *Store) ResendRegistrationChallenge(ctx context.Context, email string, challengeHash, codeHash []byte, ttl, cooldown time.Duration, maxSendsHour int) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	email = strings.ToLower(strings.TrimSpace(email))
	if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, email); err != nil {
		return err
	}
	var storedChallenge []byte
	var lastSent, windowStart time.Time
	var sendCount int
	err = tx.QueryRow(ctx,
		`SELECT challenge_hash, last_sent_at, send_window_start, send_count
		 FROM email_verification_challenges WHERE email=$1 FOR UPDATE`, email,
	).Scan(&storedChallenge, &lastSent, &windowStart, &sendCount)
	if errors.Is(err, pgx.ErrNoRows) || !secureEqual(storedChallenge, challengeHash) {
		return ErrVerificationInvalid
	}
	if err != nil {
		return err
	}
	now := time.Now()
	if now.Before(lastSent.Add(cooldown)) {
		return ErrVerificationCooldown
	}
	if now.Sub(windowStart) >= time.Hour {
		windowStart, sendCount = now, 0
	}
	if sendCount >= maxSendsHour {
		return ErrVerificationSendLimit
	}
	_, err = tx.Exec(ctx,
		`UPDATE email_verification_challenges
		 SET code_hash=$2, expires_at=$3, attempts=0, last_sent_at=$4,
		     send_window_start=$5, send_count=$6 WHERE email=$1`,
		email, codeHash, now.Add(ttl), now, windowStart, sendCount+1,
	)
	if err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// CompleteRegistration 只有 challenge token 与邮箱验证码同时匹配时才创建正式用户。
func (s *Store) CompleteRegistration(ctx context.Context, email string, challengeHash, candidateCodeHash []byte, maxAttempts int) (User, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return User{}, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended('christmas-canvas:first-user', 0))`); err != nil {
		return User{}, err
	}
	email = strings.ToLower(strings.TrimSpace(email))
	var passwordHash, displayName string
	var storedCode, storedChallenge []byte
	var expiresAt time.Time
	var attempts int
	err = tx.QueryRow(ctx,
		`SELECT password_hash, display_name, code_hash, challenge_hash, expires_at, attempts
		 FROM email_verification_challenges WHERE email=$1 FOR UPDATE`, email,
	).Scan(&passwordHash, &displayName, &storedCode, &storedChallenge, &expiresAt, &attempts)
	if errors.Is(err, pgx.ErrNoRows) || !secureEqual(storedChallenge, challengeHash) {
		return User{}, ErrVerificationInvalid
	}
	if err != nil {
		return User{}, err
	}
	if time.Now().After(expiresAt) {
		return User{}, ErrVerificationExpired
	}
	if attempts >= maxAttempts {
		return User{}, ErrVerificationTooMany
	}
	if !secureEqual(storedCode, candidateCodeHash) {
		if _, err := tx.Exec(ctx, `UPDATE email_verification_challenges SET attempts=attempts+1 WHERE email=$1`, email); err != nil {
			return User{}, err
		}
		if err := tx.Commit(ctx); err != nil {
			return User{}, err
		}
		return User{}, ErrVerificationInvalid
	}
	var count int
	if err := tx.QueryRow(ctx, `SELECT count(*) FROM users`).Scan(&count); err != nil {
		return User{}, err
	}
	role := "user"
	if count == 0 {
		role = "admin"
	}
	var u User
	err = tx.QueryRow(ctx,
		`INSERT INTO users (email, password_hash, display_name, role, email_verified_at)
		 VALUES ($1,$2,$3,$4,now())
		 RETURNING id,email,display_name,avatar_url,role,email_verified_at IS NOT NULL`,
		email, passwordHash, displayName, role,
	).Scan(&u.ID, &u.Email, &u.DisplayName, &u.AvatarURL, &u.Role, &u.EmailVerified)
	if err != nil {
		return User{}, err
	}
	if _, err := tx.Exec(ctx, `DELETE FROM email_verification_challenges WHERE email=$1`, email); err != nil {
		return User{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return User{}, err
	}
	return u, nil
}

func secureEqual(a, b []byte) bool {
	return len(a) == len(b) && subtle.ConstantTimeCompare(a, b) == 1
}
