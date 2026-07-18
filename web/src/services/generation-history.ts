import localforage from "localforage";

import { isBackendMode } from "@/constant/runtime-config";
import { upsertWorkspaceTask } from "@/services/api/workspace";

export const GENERATION_HISTORY_CHANGED = "infinite-canvas:generation-history-changed";

export type GenerationTaskStatus = "running" | "completed" | "failed";

export type GenerationTaskItem = {
    id: string;
    capability: "image" | "video";
    title: string;
    prompt: string;
    model: string;
    status: GenerationTaskStatus;
    createdAt: number;
    durationMs: number;
    resultLabel: string;
    error?: string;
    thumbnails: string[];
    request?: Record<string, unknown>;
    result?: Record<string, unknown>;
};

const imageLogStore = localforage.createInstance({ name: "infinite-canvas", storeName: "image_generation_logs" });
const videoLogStore = localforage.createInstance({ name: "infinite-canvas", storeName: "video_generation_logs" });

export function notifyGenerationHistoryChanged() {
    window.dispatchEvent(new Event(GENERATION_HISTORY_CHANGED));
}

// 生图/视频工作台仍以 localForage 保存完整大对象；backend 模式额外同步摘要与复用参数，
// 任务中心因此可以跨设备搜索，而不会把原始媒体 data URL 重复写进数据库。
export function syncGenerationTask(value: Record<string, unknown>, capability: GenerationTaskItem["capability"]) {
    if (!isBackendMode()) return;
    const images = Array.isArray(value.images) ? value.images : [];
    const result = value.video ? { video: compactMedia(value.video) } : { count: images.length, thumbnails: images.map((item) => (item as Record<string, unknown>).storageKey || "").filter(Boolean) };
    const references = Array.isArray(value.references) ? value.references.map((item) => compactMedia(item)) : [];
    void upsertWorkspaceTask({
        clientKey: `${capability}:${String(value.id || Date.now())}`,
        capability,
        status: String(value.status || "").includes("失败") ? "failed" : String(value.status || "").includes("生成中") ? "running" : "done",
        title: String(value.title || "生成任务"),
        prompt: String(value.prompt || ""),
        model: String(value.model || ""),
        request: { config: value.config || {}, references, task: value.task || null },
        result,
        error: String(value.error || ""),
    }).catch(() => undefined);
}

function compactMedia(value: unknown) {
    if (!value || typeof value !== "object") return value;
    const item = value as Record<string, unknown>;
    return { id: item.id, name: item.name, type: item.type, storageKey: item.storageKey, mimeType: item.mimeType, width: item.width, height: item.height, bytes: item.bytes, durationMs: item.durationMs };
}

export async function readGenerationTasks(): Promise<GenerationTaskItem[]> {
    const [images, videos] = await Promise.all([readStore(imageLogStore, "image"), readStore(videoLogStore, "video")]);
    return [...images, ...videos].sort((a, b) => b.createdAt - a.createdAt);
}

async function readStore(store: typeof imageLogStore, capability: GenerationTaskItem["capability"]): Promise<GenerationTaskItem[]> {
    const items: GenerationTaskItem[] = [];
    await store.iterate<Record<string, unknown>, void>((value, key) => {
        items.push(normalizeTask(value, key, capability));
    });
    return items;
}

function normalizeTask(value: Record<string, unknown>, key: string, capability: GenerationTaskItem["capability"]): GenerationTaskItem {
    const rawStatus = String(value.status || "成功");
    const status: GenerationTaskStatus = rawStatus === "生成中" || rawStatus === "pending" || rawStatus === "running" ? "running" : rawStatus === "失败" || rawStatus === "failed" ? "failed" : "completed";
    const imageCount = Number(value.successCount) || (Array.isArray(value.images) ? value.images.length : 0);
    const hasVideo = Boolean(value.video);
    const images = Array.isArray(value.images) ? value.images : [];
    const thumbnails = images.map((item) => String((item as Record<string, unknown>).dataUrl || "")).filter(Boolean);
    if (hasVideo) {
        const video = value.video as Record<string, unknown>;
        if (video.url) thumbnails.push(String(video.url));
    }
    return {
        id: String(value.id || key),
        capability,
        title: String(value.title || (capability === "image" ? "图片生成" : "视频生成")),
        prompt: String(value.prompt || ""),
        model: String(value.model || ""),
        status,
        createdAt: Number(value.createdAt) || Date.now(),
        durationMs: Number(value.durationMs) || 0,
        resultLabel: capability === "image" ? `${imageCount} 张图片` : hasVideo ? "1 个视频" : status === "running" ? "等待结果" : "无结果",
        error: typeof value.error === "string" ? value.error : undefined,
        thumbnails,
        request: typeof value.config === "object" && value.config ? { config: value.config as Record<string, unknown>, references: value.references || [] } : undefined,
        result: { images, video: value.video || null },
    };
}
