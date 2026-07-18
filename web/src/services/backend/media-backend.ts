import { httpClient } from "@/services/http-client";

// backend 模式下媒体二进制的上传/下载桥接。
// 语义化 storageKey（image:xxx / video:xxx / file:xxx）在前后端保持一致，
// 后端把它映射到对象存储中带用户前缀的真实 object，因此 UI 层的 storageKey 协议无感。
// GET /files/:key 需要 JWT（拦截器注入），无法直接作为 <img src>，
// 故下载走 blob → objectURL，保持与本地实现相同的返回形态。

export type UploadedBackendFile = { storageKey: string; objectKey: string; url: string; bytes: number; mimeType: string };
export type BackendUploadOptions = { signal?: AbortSignal; onProgress?: (progress: number) => void };

export async function uploadBlobToBackend(storageKey: string, blob: Blob, options: BackendUploadOptions = {}): Promise<UploadedBackendFile> {
    const form = new FormData();
    form.append("storageKey", storageKey);
    form.append("file", blob, storageKey.replace(/[\\/:*?"<>|]/g, "_"));
    const { data } = await httpClient.post<UploadedBackendFile>("/files", form, {
        signal: options.signal,
        timeout: 0,
        onUploadProgress: (event) => options.onProgress?.(Math.max(0, Math.min(100, Math.round((event.progress ?? 0) * 100)))),
    });
    return data;
}

export async function fetchBlobFromBackend(storageKey: string): Promise<Blob | null> {
    try {
        const { data } = await httpClient.get<Blob>(`/files/${encodeURIComponent(storageKey)}`, { responseType: "blob" });
        return data;
    } catch {
        return null;
    }
}

export async function trashBlobInBackend(storageKey: string): Promise<void> {
    await httpClient.delete(`/files/${encodeURIComponent(storageKey)}`);
}
