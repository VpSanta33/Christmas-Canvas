import localforage from "localforage";
import { nanoid } from "nanoid";
import { isBackendMode } from "@/constant/runtime-config";
import { fetchBlobFromBackend, trashBlobInBackend } from "@/services/backend/media-backend";
import { discardMediaUpload, getPendingUploadBlob, uploadBlobWithRecovery } from "@/services/media-upload-queue";

export type UploadedFile = { url: string; storageKey: string; bytes: number; mimeType: string; width?: number; height?: number; durationMs?: number; storageStatus?: "stored" | "pending"; storageError?: string };

const store = localforage.createInstance({ name: "infinite-canvas", storeName: "media_files" });
const objectUrls = new Map<string, string>();

export async function uploadMediaFile(input: string | Blob, prefix = "file"): Promise<UploadedFile> {
    const blob = typeof input === "string" ? await (await fetch(input)).blob() : input;
    const storageKey = `${prefix}:${nanoid()}`;
    const url = URL.createObjectURL(blob);
    objectUrls.set(storageKey, url);
    try {
        const meta = blob.type.startsWith("video/") ? await readVideoMeta(url) : blob.type.startsWith("audio/") ? await readAudioMeta(url) : {};
        if (isBackendMode()) {
            const upload = await uploadBlobWithRecovery(storageKey, blob);
            return { url, storageKey, bytes: blob.size, mimeType: blob.type || "application/octet-stream", ...meta, storageStatus: upload.stored ? "stored" : "pending", ...(upload.stored ? {} : { storageError: upload.error }) };
        }
        await store.setItem(storageKey, blob);
        return { url, storageKey, bytes: blob.size, mimeType: blob.type || "application/octet-stream", ...meta, storageStatus: "stored" };
    } catch (error) {
        objectUrls.delete(storageKey);
        URL.revokeObjectURL(url);
        throw error;
    }
}

export async function resolveMediaUrl(storageKey?: string, fallback = "") {
    if (!storageKey) return fallback;
    const cached = objectUrls.get(storageKey);
    if (cached) return cached;
    const blob = isBackendMode() ? (await fetchBlobFromBackend(storageKey)) || (await getPendingUploadBlob(storageKey)) : await store.getItem<Blob>(storageKey);
    if (!blob) return fallback;
    const url = URL.createObjectURL(blob);
    objectUrls.set(storageKey, url);
    return url;
}

export async function getMediaBlob(storageKey: string) {
    if (isBackendMode()) return (await fetchBlobFromBackend(storageKey)) || getPendingUploadBlob(storageKey);
    return store.getItem<Blob>(storageKey);
}

export async function setMediaBlob(storageKey: string, blob: Blob) {
    if (isBackendMode()) await uploadBlobWithRecovery(storageKey, blob);
    else await store.setItem(storageKey, blob);
    const url = URL.createObjectURL(blob);
    objectUrls.set(storageKey, url);
    return url;
}

export async function deleteStoredMedia(keys: Iterable<string>, options: { remote?: boolean } = { remote: true }) {
    await Promise.all(
        Array.from(new Set(keys)).map(async (key) => {
            const url = objectUrls.get(key);
            if (url) URL.revokeObjectURL(url);
            objectUrls.delete(key);
            await store.removeItem(key);
            await discardMediaUpload(key);
            if (isBackendMode() && options.remote !== false) await trashBlobInBackend(key).catch(() => undefined);
        }),
    );
}

export async function cleanupUnusedMedia(usedData: unknown) {
    const usedKeys = collectMediaStorageKeys(usedData);
    const unused: string[] = [];
    await store.iterate((_value, key) => {
        if (!usedKeys.has(key)) unused.push(key);
    });
    await deleteStoredMedia(unused, { remote: false });
}

export function collectMediaStorageKeys(value: unknown, keys = new Set<string>()) {
    if (!value || typeof value !== "object") return keys;
    if ("storageKey" in value && typeof value.storageKey === "string" && value.storageKey.includes(":")) keys.add(value.storageKey);
    Object.values(value).forEach((item) => (Array.isArray(item) ? item.forEach((child) => collectMediaStorageKeys(child, keys)) : collectMediaStorageKeys(item, keys)));
    return keys;
}

function readVideoMeta(url: string) {
    return new Promise<{ width: number; height: number; durationMs?: number }>((resolve) => {
        const video = document.createElement("video");
        const done = () => resolve({ width: video.videoWidth || 1280, height: video.videoHeight || 720, durationMs: Number.isFinite(video.duration) ? Math.round(video.duration * 1000) : undefined });
        video.onloadedmetadata = done;
        video.onerror = done;
        video.src = url;
    });
}

function readAudioMeta(url: string) {
    return new Promise<{ durationMs?: number }>((resolve) => {
        const audio = document.createElement("audio");
        const done = () => resolve({ durationMs: Number.isFinite(audio.duration) ? Math.round(audio.duration * 1000) : undefined });
        audio.onloadedmetadata = done;
        audio.onerror = done;
        audio.src = url;
    });
}
