-- 创作者大赛：作品可关联一份完整的画布工作流快照（前端 CanvasProject）。
-- 其他用户过审后可只读查看制作流程并一键复制。可空：老作品 / 未关联画布为 NULL。
ALTER TABLE creator_contest_entries
    ADD COLUMN IF NOT EXISTS canvas_snapshot JSONB;
