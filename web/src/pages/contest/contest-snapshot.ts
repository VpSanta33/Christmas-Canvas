import type { ContestCanvasSnapshot } from "@/services/api/contest";

const MEDIA_PREFIXES = ["image:", "video:", "audio:", "file:"];

function isStorageKey(value: unknown): value is string {
    return typeof value === "string" && MEDIA_PREFIXES.some((prefix) => value.startsWith(prefix));
}

// 递归收集快照 JSON 里所有媒体 storageKey（image:/video:/audio:/file: 前缀）。
// 与后端 contest.collectStorageKeys 同源：查看/复制时据此拉取作者媒体。
export function collectSnapshotStorageKeys(snapshot: ContestCanvasSnapshot): string[] {
    const keys = new Set<string>();
    const walk = (value: unknown) => {
        if (isStorageKey(value)) {
            keys.add(value);
            return;
        }
        if (Array.isArray(value)) {
            value.forEach(walk);
            return;
        }
        if (value && typeof value === "object") {
            Object.values(value).forEach(walk);
        }
    };
    walk(snapshot);
    return Array.from(keys);
}
