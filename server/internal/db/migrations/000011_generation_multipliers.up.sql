-- 生成参数积分倍率；未命中的参数默认按 1 倍计费。
ALTER TABLE platform_model_settings
    ADD COLUMN IF NOT EXISTS generation_multipliers JSONB NOT NULL DEFAULT '{
        "imageQuality": {"auto": 1, "low": 1, "medium": 1, "high": 1},
        "videoQuality": {"480": 1, "720": 1, "1080": 1},
        "videoSeconds": {"-1": 1, "5": 1, "6": 1, "10": 1, "12": 1, "15": 1, "16": 1, "20": 1}
    }'::jsonb;
