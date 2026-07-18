import localforage from "localforage";

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
};

const imageLogStore = localforage.createInstance({ name: "infinite-canvas", storeName: "image_generation_logs" });
const videoLogStore = localforage.createInstance({ name: "infinite-canvas", storeName: "video_generation_logs" });

export function notifyGenerationHistoryChanged() {
    window.dispatchEvent(new Event(GENERATION_HISTORY_CHANGED));
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
    };
}
