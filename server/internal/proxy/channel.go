// Package proxy 承接前端的 AI 调用：第三方渠道 key 保存在服务端（加密），
// 前端只发送 model/prompt/references 等，绝不再持有第三方 key。
package proxy

import (
	"context"
	"encoding/json"
	"errors"
	"sort"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/basketikun/infinite-canvas/server/internal/storage"
)

var (
	ErrChannelNotFound      = errors.New("channel not found")
	ErrChannelModelNotFound = errors.New("channel model not found")
	ErrUnsupportedPricing   = errors.New("model capability does not support generation pricing")
	ErrInvalidModelDefault  = errors.New("invalid model default")
)

type ChannelModel struct {
	Name              string             `json:"name"`
	Capability        string             `json:"capability"`
	GenerationPricing *GenerationPricing `json:"generationPricing,omitempty"`
	// Cost 是调用该模型一次消耗的积分；0 表示免费。
	Cost      int64 `json:"cost"`
	Enabled   *bool `json:"enabled,omitempty"`
	SortOrder int   `json:"sortOrder,omitempty"`
}

// IsEnabled 兼容旧 JSON：没有 enabled 字段的历史模型默认启用。
func (m ChannelModel) IsEnabled() bool { return m.Enabled == nil || *m.Enabled }

type ModelDefaults struct {
	Image string `json:"image"`
	Video string `json:"video"`
	Text  string `json:"text"`
	Audio string `json:"audio"`
}

// Channel 是解密后的渠道（含明文 key，仅在服务端内存中出现）。
type Channel struct {
	ID              string
	Name            string
	BaseURL         string
	APIKey          string
	APIFormat       string
	Models          []ChannelModel
	Enabled         bool
	Priority        int
	AutoPaused      bool
	PausedReason    string
	HealthUpdatedAt *time.Time
	KeyUpdatedAt    *time.Time
	KeyExpiresAt    *time.Time
}

// PublicChannel 返回给前端的形态：不含 apiKey。
type PublicChannel struct {
	ID              string         `json:"id"`
	Name            string         `json:"name"`
	BaseURL         string         `json:"baseUrl"`
	APIFormat       string         `json:"apiFormat"`
	Models          []ChannelModel `json:"models"`
	Enabled         bool           `json:"enabled"`
	Priority        int            `json:"priority"`
	AutoPaused      bool           `json:"autoPaused"`
	PausedReason    string         `json:"pausedReason"`
	HealthUpdatedAt *time.Time     `json:"healthUpdatedAt"`
	KeyUpdatedAt    *time.Time     `json:"keyUpdatedAt"`
	KeyExpiresAt    *time.Time     `json:"keyExpiresAt"`
}

// PublicModelChannel 是普通用户可见的只读模型目录。
// 不返回上游地址和密钥，浏览器只需要渠道 ID、协议、模型能力与积分价格。
type PublicModelChannel struct {
	ID        string         `json:"id"`
	Name      string         `json:"name"`
	APIFormat string         `json:"apiFormat"`
	Models    []ChannelModel `json:"models"`
	Enabled   bool           `json:"enabled"`
}

type ChannelStore struct {
	pool   *pgxpool.Pool
	cipher *storage.Cipher
}

func NewChannelStore(pool *pgxpool.Pool, cipher *storage.Cipher) *ChannelStore {
	return &ChannelStore{pool: pool, cipher: cipher}
}

func (s *ChannelStore) Create(ctx context.Context, ch Channel) (string, error) {
	cipherKey, err := s.cipher.Encrypt([]byte(ch.APIKey))
	if err != nil {
		return "", err
	}
	models, _ := json.Marshal(normalizeChannelModelPricing(ch.Models))
	var id string
	err = s.pool.QueryRow(ctx,
		`INSERT INTO channels (name, base_url, api_key_cipher, api_format, models, enabled, priority, key_expires_at)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
		ch.Name, ch.BaseURL, cipherKey, ch.APIFormat, models, ch.Enabled, ch.Priority, ch.KeyExpiresAt,
	).Scan(&id)
	return id, err
}

func (s *ChannelStore) Get(ctx context.Context, id string) (Channel, error) {
	var ch Channel
	var cipherKey []byte
	var models []byte
	err := s.pool.QueryRow(ctx,
		`SELECT id, name, base_url, api_key_cipher, api_format, models, enabled, priority,
		        auto_paused, paused_reason, health_updated_at, key_updated_at, key_expires_at
		 FROM channels WHERE id = $1`, id,
	).Scan(&ch.ID, &ch.Name, &ch.BaseURL, &cipherKey, &ch.APIFormat, &models, &ch.Enabled, &ch.Priority,
		&ch.AutoPaused, &ch.PausedReason, &ch.HealthUpdatedAt, &ch.KeyUpdatedAt, &ch.KeyExpiresAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return Channel{}, ErrChannelNotFound
	}
	if err != nil {
		return Channel{}, err
	}
	plain, err := s.cipher.Decrypt(cipherKey)
	if err != nil {
		return Channel{}, err
	}
	ch.APIKey = string(plain)
	_ = json.Unmarshal(models, &ch.Models)
	ch.Models = normalizeChannelModelPricing(ch.Models)
	return ch, nil
}

// ListPublic 返回启用渠道（不含 key），供前端渲染可选模型。
func (s *ChannelStore) ListPublic(ctx context.Context) ([]PublicChannel, error) {
	return s.list(ctx, true)
}

// ListAll 返回全部渠道（含禁用，不含 key），供 admin 管理列表。
func (s *ChannelStore) ListAll(ctx context.Context) ([]PublicChannel, error) {
	return s.list(ctx, false)
}

// ModelOperations 返回全平台默认模型与自动故障切换开关。
func (s *ChannelStore) ModelOperations(ctx context.Context) (ModelDefaults, bool, GenerationPricing, error) {
	var raw, rawPricing []byte
	var failoverEnabled bool
	err := s.pool.QueryRow(ctx, `SELECT defaults, failover_enabled, generation_pricing FROM platform_model_settings WHERE id = 1`).Scan(&raw, &failoverEnabled, &rawPricing)
	if errors.Is(err, pgx.ErrNoRows) {
		return ModelDefaults{}, true, defaultGenerationPricing(), nil
	}
	if err != nil {
		return ModelDefaults{}, false, GenerationPricing{}, err
	}
	var defaults ModelDefaults
	if err := json.Unmarshal(raw, &defaults); err != nil {
		return ModelDefaults{}, false, GenerationPricing{}, err
	}
	var pricing GenerationPricing
	if err := json.Unmarshal(rawPricing, &pricing); err != nil {
		return ModelDefaults{}, false, GenerationPricing{}, err
	}
	return defaults, failoverEnabled, normalizeGenerationPricing(pricing), nil
}

func (s *ChannelStore) ModelDefaults(ctx context.Context) (ModelDefaults, error) {
	defaults, _, _, err := s.ModelOperations(ctx)
	return defaults, err
}

// UpdateModelOperations 校验默认模型，并保存自动故障切换开关。
func (s *ChannelStore) UpdateModelOperations(ctx context.Context, defaults ModelDefaults, failoverEnabled bool, pricing GenerationPricing) error {
	channels, err := s.ListAll(ctx)
	if err != nil {
		return err
	}
	values := []struct {
		capability string
		value      string
	}{
		{"image", defaults.Image}, {"video", defaults.Video},
		{"text", defaults.Text}, {"audio", defaults.Audio},
	}
	for _, item := range values {
		if item.value != "" && !validModelDefault(channels, item.value, item.capability) {
			return ErrInvalidModelDefault
		}
	}
	raw, _ := json.Marshal(defaults)
	rawPricing, _ := json.Marshal(normalizeGenerationPricing(pricing))
	_, err = s.pool.Exec(ctx,
		`INSERT INTO platform_model_settings (id, defaults, failover_enabled, generation_pricing, updated_at) VALUES (1, $1, $2, $3, now())
		 ON CONFLICT (id) DO UPDATE SET defaults = EXCLUDED.defaults, failover_enabled = EXCLUDED.failover_enabled, generation_pricing = EXCLUDED.generation_pricing, updated_at = now()`, raw, failoverEnabled, rawPricing)
	return err
}

// FallbackChannels 返回支持同名、同能力模型的其他启用渠道，按渠道优先级排序。
func (s *ChannelStore) FallbackChannels(ctx context.Context, primaryID, model, capability, apiFormat string) ([]Channel, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT id, name, base_url, api_key_cipher, api_format, models, enabled, priority,
		        auto_paused, paused_reason, health_updated_at, key_updated_at, key_expires_at
		 FROM channels WHERE enabled = true AND id <> $1 ORDER BY priority, created_at`, primaryID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []Channel{}
	for rows.Next() {
		var channel Channel
		var cipherKey, rawModels []byte
		if err := rows.Scan(&channel.ID, &channel.Name, &channel.BaseURL, &cipherKey, &channel.APIFormat, &rawModels,
			&channel.Enabled, &channel.Priority, &channel.AutoPaused, &channel.PausedReason, &channel.HealthUpdatedAt,
			&channel.KeyUpdatedAt, &channel.KeyExpiresAt); err != nil {
			return nil, err
		}
		_ = json.Unmarshal(rawModels, &channel.Models)
		channel.Models = normalizeChannelModelPricing(channel.Models)
		configured, ok := findChannelModel(channel.Models, model)
		if !ok || configured.Capability != capability || channel.APIFormat != apiFormat {
			continue
		}
		plain, err := s.cipher.Decrypt(cipherKey)
		if err != nil {
			return nil, err
		}
		channel.APIKey = string(plain)
		out = append(out, channel)
	}
	return out, rows.Err()
}

func (s *ChannelStore) list(ctx context.Context, enabledOnly bool) ([]PublicChannel, error) {
	q := `SELECT id, name, base_url, api_format, models, enabled, priority,
	             auto_paused, paused_reason, health_updated_at, key_updated_at, key_expires_at FROM channels`
	if enabledOnly {
		q += ` WHERE enabled = true`
	}
	q += ` ORDER BY priority, created_at`
	rows, err := s.pool.Query(ctx, q)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []PublicChannel{}
	for rows.Next() {
		var pc PublicChannel
		var models []byte
		if err := rows.Scan(&pc.ID, &pc.Name, &pc.BaseURL, &pc.APIFormat, &models, &pc.Enabled, &pc.Priority,
			&pc.AutoPaused, &pc.PausedReason, &pc.HealthUpdatedAt, &pc.KeyUpdatedAt, &pc.KeyExpiresAt); err != nil {
			return nil, err
		}
		_ = json.Unmarshal(models, &pc.Models)
		pc.Models = normalizeChannelModelPricing(pc.Models)
		sort.SliceStable(pc.Models, func(i, j int) bool {
			if pc.Models[i].SortOrder == pc.Models[j].SortOrder {
				return false
			}
			return pc.Models[i].SortOrder < pc.Models[j].SortOrder
		})
		out = append(out, pc)
	}
	return out, nil
}

func activeChannelModels(models []ChannelModel) []ChannelModel {
	active := make([]ChannelModel, 0, len(models))
	for _, model := range models {
		if model.IsEnabled() {
			active = append(active, model)
		}
	}
	return active
}

func normalizeChannelModelPricing(models []ChannelModel) []ChannelModel {
	out := make([]ChannelModel, len(models))
	copy(out, models)
	for index := range out {
		if out[index].GenerationPricing == nil {
			continue
		}
		normalized := normalizeGenerationPricing(*out[index].GenerationPricing)
		out[index].GenerationPricing = &normalized
	}
	return out
}

func validModelDefault(channels []PublicChannel, value, capability string) bool {
	parts := strings.SplitN(strings.TrimSpace(value), "::", 2)
	if len(parts) != 2 || parts[0] == "" || parts[1] == "" {
		return false
	}
	for _, channel := range channels {
		if channel.ID != parts[0] || !channel.Enabled {
			continue
		}
		for _, model := range channel.Models {
			if model.IsEnabled() && model.Capability == capability && model.Name == parts[1] {
				return true
			}
		}
	}
	return false
}

func sanitizeModelDefaults(channels []PublicChannel, defaults ModelDefaults) ModelDefaults {
	if !validModelDefault(channels, defaults.Image, "image") {
		defaults.Image = ""
	}
	if !validModelDefault(channels, defaults.Video, "video") {
		defaults.Video = ""
	}
	if !validModelDefault(channels, defaults.Text, "text") {
		defaults.Text = ""
	}
	if !validModelDefault(channels, defaults.Audio, "audio") {
		defaults.Audio = ""
	}
	return defaults
}

// ChannelUpdate 描述一次渠道更新。APIKey 为空表示保留原有密钥不变。
type ChannelUpdate struct {
	Name         string
	BaseURL      string
	APIKey       string
	APIFormat    string
	Models       []ChannelModel
	Enabled      bool
	Priority     int
	KeyExpiresAt *time.Time
}

// Update 更新渠道；仅当 APIKey 非空时才重新加密写入密钥，否则保留原值。
func (s *ChannelStore) Update(ctx context.Context, id string, u ChannelUpdate) error {
	models, _ := json.Marshal(normalizeChannelModelPricing(u.Models))
	var tag pgconn.CommandTag
	var err error
	if u.APIKey != "" {
		cipherKey, encErr := s.cipher.Encrypt([]byte(u.APIKey))
		if encErr != nil {
			return encErr
		}
		tag, err = s.pool.Exec(ctx,
			`UPDATE channels SET name=$2, base_url=$3, api_key_cipher=$4, api_format=$5, models=$6,
			        enabled=$7, priority=$8, auto_paused=CASE WHEN $7 THEN false ELSE auto_paused END,
			        paused_reason=CASE WHEN $7 THEN '' ELSE paused_reason END,
			        key_updated_at=now(), key_expires_at=$9 WHERE id=$1`,
			id, u.Name, u.BaseURL, cipherKey, u.APIFormat, models, u.Enabled, u.Priority, u.KeyExpiresAt)
	} else {
		tag, err = s.pool.Exec(ctx,
			`UPDATE channels SET name=$2, base_url=$3, api_format=$4, models=$5, enabled=$6, priority=$7,
			        auto_paused=CASE WHEN $6 THEN false ELSE auto_paused END,
			        paused_reason=CASE WHEN $6 THEN '' ELSE paused_reason END,
			        key_expires_at=$8 WHERE id=$1`,
			id, u.Name, u.BaseURL, u.APIFormat, models, u.Enabled, u.Priority, u.KeyExpiresAt)
	}
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrChannelNotFound
	}
	return nil
}

// UpdateModelPricing 原子更新渠道中某个模型的独立参数积分表。
func (s *ChannelStore) UpdateModelPricing(ctx context.Context, channelID, modelName string, pricing GenerationPricing) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var raw []byte
	if err := tx.QueryRow(ctx, `SELECT models FROM channels WHERE id=$1 FOR UPDATE`, channelID).Scan(&raw); errors.Is(err, pgx.ErrNoRows) {
		return ErrChannelNotFound
	} else if err != nil {
		return err
	}
	var models []ChannelModel
	if err := json.Unmarshal(raw, &models); err != nil {
		return err
	}
	index := -1
	for i := range models {
		if models[i].Name == modelName || strings.EqualFold(models[i].Name, modelName) {
			index = i
			break
		}
	}
	if index < 0 {
		return ErrChannelModelNotFound
	}
	if models[index].Capability != "image" && models[index].Capability != "video" {
		return ErrUnsupportedPricing
	}
	normalized := normalizeGenerationPricing(pricing)
	models[index].GenerationPricing = &normalized
	next, _ := json.Marshal(models)
	if _, err := tx.Exec(ctx, `UPDATE channels SET models=$2 WHERE id=$1`, channelID, next); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// SetEnabled 仅切换启用状态。
func (s *ChannelStore) SetEnabled(ctx context.Context, id string, enabled bool) error {
	tag, err := s.pool.Exec(ctx,
		`UPDATE channels SET enabled=$2,
		        auto_paused=CASE WHEN $2 THEN false ELSE auto_paused END,
		        paused_reason=CASE WHEN $2 THEN '' ELSE paused_reason END
		 WHERE id=$1`, id, enabled)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrChannelNotFound
	}
	return nil
}

func (s *ChannelStore) UpdateHealth(ctx context.Context, id string, result HealthResult) {
	reason := ""
	if !result.OK {
		reason = result.Message
	}
	_, _ = s.pool.Exec(ctx,
		`UPDATE channels SET health_updated_at=now(), paused_reason=CASE WHEN auto_paused THEN paused_reason ELSE $2 END
		 WHERE id=$1`, id, reason)
}

// Delete 删除渠道。
func (s *ChannelStore) Delete(ctx context.Context, id string) error {
	tag, err := s.pool.Exec(ctx, `DELETE FROM channels WHERE id=$1`, id)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrChannelNotFound
	}
	return nil
}
