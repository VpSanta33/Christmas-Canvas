// Package db 负责数据库连接池与迁移执行。
// 迁移文件通过 go:embed 打包进二进制，启动时用 golang-migrate 库自动执行，
// 无需外部 migrate CLI。
package db

import (
	"context"
	"embed"
	"errors"
	"fmt"

	"github.com/golang-migrate/migrate/v4"
	"github.com/golang-migrate/migrate/v4/database/pgx/v5"
	"github.com/golang-migrate/migrate/v4/source/iofs"
	"github.com/jackc/pgx/v5/pgxpool"
)

//go:embed migrations/*.sql
var migrationsFS embed.FS

// Connect 建立 pgx 连接池。
func Connect(ctx context.Context, dsn string) (*pgxpool.Pool, error) {
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		return nil, fmt.Errorf("pgxpool.New: %w", err)
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("ping db: %w", err)
	}
	return pool, nil
}

// Migrate 执行 up 迁移到最新版本。已是最新则无操作。
func Migrate(dsn string) error {
	src, err := iofs.New(migrationsFS, "migrations")
	if err != nil {
		return fmt.Errorf("iofs source: %w", err)
	}
	m, err := migrate.NewWithSourceInstance("iofs", src, "pgx5://"+trimScheme(dsn))
	if err != nil {
		return fmt.Errorf("migrate init: %w", err)
	}
	defer m.Close()
	if err := m.Up(); err != nil && !errors.Is(err, migrate.ErrNoChange) {
		return fmt.Errorf("migrate up: %w", err)
	}
	return nil
}

// golang-migrate 的 pgx5 driver 使用 pgx5:// scheme；把 postgres:// / postgresql:// 前缀去掉后重拼。
func trimScheme(dsn string) string {
	for _, p := range []string{"postgres://", "postgresql://", "pgx5://"} {
		if len(dsn) >= len(p) && dsn[:len(p)] == p {
			return dsn[len(p):]
		}
	}
	return dsn
}

var _ = pgx.ErrNilConfig // 确保 pgx5 database driver 被链接注册
