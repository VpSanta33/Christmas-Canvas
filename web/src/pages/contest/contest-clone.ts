import { setImageBlob } from "@/services/image-storage";
import { setMediaBlob } from "@/services/file-storage";
import { fetchContestSnapshotBlob, type ContestCanvasSnapshot } from "@/services/api/contest";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { nanoid } from "nanoid";
import { collectSnapshotStorageKeys } from "./contest-snapshot";

// cloneContestProject 把一件已过审作品的画布快照复制成复制者自己的项目：
// 1) 逐个把作者媒体（凭 storageKey 走大赛只读端点）落地到本地 + 上传到自己的账号，
//    同时生成新的 storageKey，避免后端 files.storage_key 全局主键与作者文件冲突；
// 2) importProject 生成新画布，返回新项目 id 供跳转。
export async function cloneContestProject(entryId: string, snapshot: ContestCanvasSnapshot, title: string): Promise<string> {
    const keys = collectSnapshotStorageKeys(snapshot);
    const replacements = new Map<string, string>();
    await Promise.all(
        keys.map(async (key) => {
            try {
                const blob = await fetchContestSnapshotBlob(entryId, key);
                const separator = key.indexOf(":");
                const nextKey = `${separator > 0 ? key.slice(0, separator) : "file"}:${nanoid()}`;
                if (key.startsWith("image:")) await setImageBlob(nextKey, blob);
                else await setMediaBlob(nextKey, blob);
                replacements.set(key, nextKey);
            } catch {
                // 单个媒体拉取/落地失败不阻断整体复制，节点会显示占位符。
            }
        }),
    );

    const clonedSnapshot = remapSnapshotStorageKeys(snapshot, replacements);
    return useCanvasStore.getState().importProject({
        title: title ? `${title}（副本）` : "大赛作品副本",
        nodes: clonedSnapshot.nodes,
        connections: clonedSnapshot.connections,
        chatSessions: clonedSnapshot.chatSessions,
        backgroundMode: clonedSnapshot.backgroundMode,
        showImageInfo: clonedSnapshot.showImageInfo,
        viewport: clonedSnapshot.viewport,
    });
}

function remapSnapshotStorageKeys(snapshot: ContestCanvasSnapshot, replacements: Map<string, string>): ContestCanvasSnapshot {
    const visit = (value: unknown): unknown => {
        if (typeof value === "string") return replacements.get(value) ?? value;
        if (Array.isArray(value)) return value.map(visit);
        if (value && typeof value === "object") {
            return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, visit(item)]));
        }
        return value;
    };
    return visit(snapshot) as ContestCanvasSnapshot;
}
