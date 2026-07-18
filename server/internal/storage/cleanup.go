package storage

import (
	"context"
	"fmt"
)

type CleanupStats struct {
	ActiveFiles  int   `json:"activeFiles"`
	ActiveBytes  int64 `json:"activeBytes"`
	TrashedFiles int   `json:"trashedFiles"`
	TrashedBytes int64 `json:"trashedBytes"`
	ExpiredFiles int   `json:"expiredFiles"`
}

type CleanupResult struct {
	DeletedFiles int   `json:"deletedFiles"`
	DeletedBytes int64 `json:"deletedBytes"`
	FailedFiles  int   `json:"failedFiles"`
}

func (m *Manager) CleanupStats(ctx context.Context) (CleanupStats, error) {
	m.mu.RLock()
	days := m.settings.TrashRetentionDays
	m.mu.RUnlock()
	var stats CleanupStats
	err := m.pool.QueryRow(ctx,
		`SELECT
		 count(*) FILTER (WHERE deleted_at IS NULL),
		 COALESCE(sum(bytes) FILTER (WHERE deleted_at IS NULL), 0),
		 count(*) FILTER (WHERE deleted_at IS NOT NULL),
		 COALESCE(sum(bytes) FILTER (WHERE deleted_at IS NOT NULL), 0),
		 count(*) FILTER (WHERE deleted_at <= now() - make_interval(days => $1))
		 FROM files`, days).Scan(&stats.ActiveFiles, &stats.ActiveBytes, &stats.TrashedFiles,
		&stats.TrashedBytes, &stats.ExpiredFiles)
	return stats, err
}

// PurgeExpired 每次最多清理 500 个到期对象，避免一次管理请求长时间占用连接。
func (m *Manager) PurgeExpired(ctx context.Context) (CleanupResult, error) {
	m.mu.RLock()
	days := m.settings.TrashRetentionDays
	m.mu.RUnlock()
	rows, err := m.pool.Query(ctx,
		`SELECT storage_key, object_key, bytes FROM files
		 WHERE deleted_at <= now() - make_interval(days => $1)
		 ORDER BY deleted_at LIMIT 500`, days)
	if err != nil {
		return CleanupResult{}, err
	}
	type cleanupItem struct {
		storageKey string
		objectKey  string
		bytes      int64
	}
	items := []cleanupItem{}
	for rows.Next() {
		var item cleanupItem
		if err := rows.Scan(&item.storageKey, &item.objectKey, &item.bytes); err != nil {
			rows.Close()
			return CleanupResult{}, err
		}
		items = append(items, item)
	}
	rows.Close()
	result := CleanupResult{}
	for _, item := range items {
		if err := m.Delete(ctx, item.objectKey); err != nil {
			result.FailedFiles++
			continue
		}
		tag, err := m.pool.Exec(ctx, `DELETE FROM files WHERE storage_key=$1 AND deleted_at IS NOT NULL`, item.storageKey)
		if err != nil {
			return result, fmt.Errorf("delete file metadata: %w", err)
		}
		if tag.RowsAffected() > 0 {
			result.DeletedFiles++
			result.DeletedBytes += item.bytes
		}
	}
	return result, nil
}
