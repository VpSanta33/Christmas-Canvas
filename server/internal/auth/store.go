package auth

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var ErrEmailTaken = errors.New("email already registered")
var ErrNotFound = errors.New("user not found")
var ErrDisabled = errors.New("account disabled")
var ErrEmailUnverified = errors.New("email not verified")

type User struct {
	ID             string `json:"id"`
	Email          string `json:"email"`
	EmailVerified  bool   `json:"emailVerified"`
	DisplayName    string `json:"displayName"`
	AvatarURL      string `json:"avatarUrl"`
	Role           string `json:"role"`
	Credits        int64  `json:"credits"`
	Disabled       bool   `json:"-"`
	SessionVersion int    `json:"-"`
}

type Store struct {
	pool *pgxpool.Pool
}

func NewStore(pool *pgxpool.Pool) *Store { return &Store{pool: pool} }

func (s *Store) Create(ctx context.Context, email, passwordHash, displayName, role string, emailVerified bool) (User, error) {
	email = strings.ToLower(strings.TrimSpace(email))
	var u User
	err := s.pool.QueryRow(ctx,
		`INSERT INTO users (email, password_hash, display_name, role, email_verified_at)
		 VALUES ($1, $2, $3, $4, CASE WHEN $5 THEN now() ELSE NULL END)
		 RETURNING id, email, display_name, avatar_url, role, email_verified_at IS NOT NULL`,
		email, passwordHash, displayName, role, emailVerified,
	).Scan(&u.ID, &u.Email, &u.DisplayName, &u.AvatarURL, &u.Role, &u.EmailVerified)
	if err != nil {
		if strings.Contains(err.Error(), "users_email_key") {
			return User{}, ErrEmailTaken
		}
		return User{}, err
	}
	// 默认配额
	_, _ = s.pool.Exec(ctx, `INSERT INTO user_quotas (user_id) VALUES ($1) ON CONFLICT DO NOTHING`, u.ID)
	return u, nil
}

func (s *Store) FindByEmail(ctx context.Context, email string) (User, string, error) {
	email = strings.ToLower(strings.TrimSpace(email))
	var u User
	var hash string
	err := s.pool.QueryRow(ctx,
		`SELECT id, email, display_name, avatar_url, role, disabled, credits, session_version,
		        password_hash, email_verified_at IS NOT NULL
		 FROM users WHERE email = $1`,
		email,
	).Scan(&u.ID, &u.Email, &u.DisplayName, &u.AvatarURL, &u.Role, &u.Disabled,
		&u.Credits, &u.SessionVersion, &hash, &u.EmailVerified)
	if errors.Is(err, pgx.ErrNoRows) {
		return User{}, "", ErrNotFound
	}
	if err != nil {
		return User{}, "", err
	}
	return u, hash, nil
}

func (s *Store) FindByID(ctx context.Context, id string) (User, error) {
	var u User
	err := s.pool.QueryRow(ctx,
		`SELECT id, email, display_name, avatar_url, role, disabled, credits, session_version,
		        email_verified_at IS NOT NULL
		 FROM users WHERE id = $1`, id,
	).Scan(&u.ID, &u.Email, &u.DisplayName, &u.AvatarURL, &u.Role, &u.Disabled,
		&u.Credits, &u.SessionVersion, &u.EmailVerified)
	if errors.Is(err, pgx.ErrNoRows) {
		return User{}, ErrNotFound
	}
	return u, err
}

func (s *Store) CountUsers(ctx context.Context) (int, error) {
	var n int
	err := s.pool.QueryRow(ctx, `SELECT count(*) FROM users`).Scan(&n)
	return n, err
}

// AdminUser 是 admin 列表返回的用户形态（含禁用状态与配额、当日用量）。
type AdminUser struct {
	ID            string `json:"id"`
	Email         string `json:"email"`
	EmailVerified bool   `json:"emailVerified"`
	DisplayName   string `json:"displayName"`
	Role          string `json:"role"`
	Disabled      bool   `json:"disabled"`
	Credits       int64  `json:"credits"`
	DailyLimit    int    `json:"dailyLimit"`
	UsedToday     int    `json:"usedToday"`
	CreatedAt     string `json:"createdAt"`
}

// ListUsers 返回全部用户（含配额与当日用量），供 admin 管理。
func (s *Store) ListUsers(ctx context.Context) ([]AdminUser, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT u.id, u.email, u.email_verified_at IS NOT NULL, u.display_name, u.role, u.disabled, u.credits,
		        COALESCE(q.daily_limit, 50),
		        COALESCE((SELECT count(DISTINCT COALESCE(NULLIF(r.request_id, ''), r.id::text))
		                  FROM usage_records r WHERE r.user_id = u.id AND r.status <> 'rejected'
		                  AND r.created_at >= date_trunc('day', now())), 0),
		        u.created_at
		 FROM users u
		 LEFT JOIN user_quotas q ON q.user_id = u.id
		 ORDER BY u.created_at`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []AdminUser{}
	for rows.Next() {
		var u AdminUser
		var createdAt time.Time
		if err := rows.Scan(&u.ID, &u.Email, &u.EmailVerified, &u.DisplayName, &u.Role, &u.Disabled, &u.Credits,
			&u.DailyLimit, &u.UsedToday, &createdAt); err != nil {
			return nil, err
		}
		u.CreatedAt = createdAt.Format(time.RFC3339)
		out = append(out, u)
	}
	return out, nil
}

// SetRole 更新用户角色（user | admin）。
func (s *Store) SetRole(ctx context.Context, id, role string) error {
	tag, err := s.pool.Exec(ctx, `UPDATE users SET role=$2, session_version=session_version+1 WHERE id=$1`, id, role)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// SetDisabled 启用/禁用（封禁）用户。
func (s *Store) SetDisabled(ctx context.Context, id string, disabled bool) error {
	tag, err := s.pool.Exec(ctx, `UPDATE users SET disabled=$2, session_version=session_version+1 WHERE id=$1`, id, disabled)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// ValidateSession 在鉴权后校验账号状态、角色与会话代际。管理员吊销会话或修改角色后，
// 所有旧 access/refresh token 会立即失效。
func (s *Store) ValidateSession(ctx context.Context, userID string, sessionVersion int) (string, error) {
	var role string
	var disabled bool
	var currentVersion int
	var emailVerified bool
	err := s.pool.QueryRow(ctx,
		`SELECT role, disabled, session_version, email_verified_at IS NOT NULL FROM users WHERE id=$1`, userID,
	).Scan(&role, &disabled, &currentVersion, &emailVerified)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrNotFound
	}
	if err != nil {
		return "", err
	}
	if disabled {
		return "", ErrDisabled
	}
	if !emailVerified {
		return "", ErrEmailUnverified
	}
	if currentVersion != sessionVersion {
		return "", errors.New("session revoked")
	}
	return role, nil
}

func (s *Store) RevokeSessions(ctx context.Context, id string) error {
	tag, err := s.pool.Exec(ctx, `UPDATE users SET session_version=session_version+1 WHERE id=$1`, id)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// SetDailyLimit 更新用户每日配额（upsert）。
func (s *Store) SetDailyLimit(ctx context.Context, id string, limit int) error {
	tag, err := s.pool.Exec(ctx,
		`INSERT INTO user_quotas (user_id, daily_limit) VALUES ($1, $2)
		 ON CONFLICT (user_id) DO UPDATE SET daily_limit = EXCLUDED.daily_limit`,
		id, limit)
	if err != nil {
		return err
	}
	_ = tag
	return nil
}

// DeleteUser 删除用户；关联的画布/资产/文件/配额/用量/积分流水均由外键 ON DELETE CASCADE
// 一并清除（对象存储中的二进制需调用方在删库前另行清理）。
func (s *Store) DeleteUser(ctx context.Context, id string) error {
	tag, err := s.pool.Exec(ctx, `DELETE FROM users WHERE id=$1`, id)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}
