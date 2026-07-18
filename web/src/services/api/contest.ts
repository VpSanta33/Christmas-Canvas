import { httpClient } from "@/services/http-client";
import type { CanvasProject } from "@/stores/canvas/use-canvas-store";

export type ContestRecipeType = "prompt" | "skill";

export type ContestStatus = "pending" | "approved" | "rejected";

export type ContestEntry = {
    id: string;
    title: string;
    description: string;
    recipeType: ContestRecipeType;
    recipePreview: string;
    videoMimeType: string;
    authorId: string;
    authorName: string;
    likes: number;
    likedByMe: boolean;
    favoritedByMe: boolean;
    mine: boolean;
    status: ContestStatus;
    hasWorkflow: boolean;
    createdAt: string;
};

// 快照即前端 CanvasProject，但作者的 id/时间无意义，复制时会重新生成。
export type ContestCanvasSnapshot = Partial<CanvasProject>;

export type ContestEntryDetail = ContestEntry & {
    recipeContent: string;
    canvasSnapshot?: ContestCanvasSnapshot | null;
};

export type ContestStats = {
    entries: number;
    creators: number;
    likes: number;
};

export type ContestCreatePayload = {
    videoStorageKey: string;
    coverStorageKey: string;
    title: string;
    description: string;
    recipeType: ContestRecipeType;
    recipeContent: string;
    canvasSnapshot?: ContestCanvasSnapshot | null;
};

export async function fetchContestEntries(options?: { sort?: "popular" | "latest"; scope?: "all" | "mine"; limit?: number }) {
    const { data } = await httpClient.get<{ items: ContestEntry[]; stats: ContestStats }>("/contest", {
        params: {
            sort: options?.sort || "popular",
            scope: options?.scope === "mine" ? "mine" : undefined,
            limit: options?.limit || 48,
        },
    });
    return { items: data.items ?? [], stats: data.stats ?? { entries: 0, creators: 0, likes: 0 } };
}

export async function fetchShowcaseEntries(limit = 9) {
    const { data } = await httpClient.get<{ items: ContestEntry[]; stats: ContestStats }>("/showcase", { params: { limit } });
    return { items: data.items ?? [], stats: data.stats ?? { entries: 0, creators: 0, likes: 0 } };
}

export async function fetchContestEntry(id: string) {
    const { data } = await httpClient.get<{ entry: ContestEntryDetail }>(`/contest/${encodeURIComponent(id)}`);
    return data.entry;
}

export async function createContestEntry(payload: ContestCreatePayload) {
    const { data } = await httpClient.post<{ id: string }>("/contest", payload);
    return data.id;
}

export async function likeContestEntry(id: string) {
    const { data } = await httpClient.post<{ liked: boolean; likes: number }>(`/contest/${encodeURIComponent(id)}/like`);
    return data;
}

export async function favoriteContestEntry(id: string, favorite: boolean) {
    const path = `/contest/${encodeURIComponent(id)}/favorite`;
    const { data } = favorite ? await httpClient.post<{ favorited: boolean }>(path) : await httpClient.delete<{ favorited: boolean }>(path);
    return data.favorited;
}

async function fetchContestBlob(id: string, kind: "cover" | "media") {
    const { data } = await httpClient.get<Blob>(`/contest/${encodeURIComponent(id)}/${kind}`, { responseType: "blob" });
    return data;
}

export function fetchContestCover(id: string) {
    return fetchContestBlob(id, "cover");
}

export async function fetchShowcaseCover(id: string) {
    const { data } = await httpClient.get<Blob>(`/showcase/${encodeURIComponent(id)}/cover`, { responseType: "blob" });
    return data;
}

export function fetchContestVideo(id: string) {
    return fetchContestBlob(id, "media");
}

// 拉取「别人已过审作品」画布快照里引用的媒体：只读查看与复制项目时，需要跨账号
// 加载作者的图 / 视频，后端会校验该 storageKey 确属这件作品的快照。
export async function fetchContestSnapshotBlob(entryId: string, storageKey: string) {
    const { data } = await httpClient.get<Blob>(`/contest/${encodeURIComponent(entryId)}/files/${encodeURIComponent(storageKey)}`, { responseType: "blob" });
    return data;
}
