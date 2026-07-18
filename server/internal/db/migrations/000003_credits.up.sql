-- 积分系统：用户余额 + 流水台账。
-- 余额直接落在 users 表上，扣费/充值用行级原子 UPDATE 保证并发安全。
ALTER TABLE users ADD COLUMN IF NOT EXISTS credits BIGINT NOT NULL DEFAULT 0;

-- 积分流水：每一次赠送/充值/消费/退款都留痕，balance_after 记录当次操作后的余额，便于对账。
CREATE TABLE IF NOT EXISTS credit_ledger (
    id            BIGSERIAL PRIMARY KEY,
    user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    delta         BIGINT NOT NULL,                 -- 正为增加，负为扣减
    balance_after BIGINT NOT NULL,
    reason        TEXT NOT NULL,                   -- register | admin_topup | consume | refund
    capability    TEXT NOT NULL DEFAULT '',        -- 消费时记录能力：image | video | audio | text
    channel_id    UUID,                            -- 消费时的渠道
    model         TEXT NOT NULL DEFAULT '',        -- 消费时的模型
    note          TEXT NOT NULL DEFAULT '',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_credit_ledger_user_time ON credit_ledger (user_id, created_at DESC);
