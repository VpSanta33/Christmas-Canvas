import localforage from "localforage";
import { useSyncExternalStore } from "react";

import { uploadBlobToBackend, type UploadedBackendFile } from "@/services/backend/media-backend";
import { extractErrorMessage } from "@/utils/http-error";

export type MediaUploadStatus = "uploading" | "failed" | "completed";

export type MediaUploadRecord = {
    storageKey: string;
    kind: string;
    bytes: number;
    mimeType: string;
    status: MediaUploadStatus;
    progress: number;
    attempts: number;
    error: string;
    objectKey: string;
    createdAt: number;
    updatedAt: number;
};

type StoredUpload = { record: MediaUploadRecord; blob: Blob };
export type RecoverableUploadResult = { stored: true; file: UploadedBackendFile } | { stored: false; error: string };

const queueStore = localforage.createInstance({ name: "infinite-canvas", storeName: "pending_media_uploads" });
const listeners = new Set<() => void>();
const controllers = new Map<string, AbortController>();
const inflight = new Map<string, Promise<RecoverableUploadResult>>();
let snapshot: MediaUploadRecord[] = [];
let initializePromise: Promise<void> | null = null;

function emit(records: MediaUploadRecord[]) {
    snapshot = [...records].sort((a, b) => b.updatedAt - a.updatedAt);
    listeners.forEach((listener) => listener());
}

function upsertRecord(record: MediaUploadRecord) {
    emit([record, ...snapshot.filter((item) => item.storageKey !== record.storageKey)]);
}

function removeRecord(storageKey: string) {
    emit(snapshot.filter((item) => item.storageKey !== storageKey));
}

async function initializeQueue() {
    if (initializePromise) return initializePromise;
    initializePromise = (async () => {
        const records: MediaUploadRecord[] = [];
        await queueStore.iterate<StoredUpload, void>((value) => {
            records.push({
                ...value.record,
                status: "failed",
                progress: 0,
                error: value.record.error || "上次上传未完成，可重新上传",
            });
        });
        emit(records);
    })();
    return initializePromise;
}

export function subscribeMediaUploadQueue(listener: () => void) {
    listeners.add(listener);
    void initializeQueue();
    return () => listeners.delete(listener);
}

export function getMediaUploadSnapshot() {
    return snapshot;
}

export function useMediaUploadQueue() {
    return useSyncExternalStore(subscribeMediaUploadQueue, getMediaUploadSnapshot, getMediaUploadSnapshot);
}

export async function uploadBlobWithRecovery(storageKey: string, blob: Blob): Promise<RecoverableUploadResult> {
    await initializeQueue();
    const existing = inflight.get(storageKey);
    if (existing) return existing;
    const task = runUpload(storageKey, blob);
    inflight.set(storageKey, task);
    try {
        return await task;
    } finally {
        inflight.delete(storageKey);
    }
}

async function runUpload(storageKey: string, blob: Blob): Promise<RecoverableUploadResult> {
    const now = Date.now();
    const previous = snapshot.find((item) => item.storageKey === storageKey);
    const record: MediaUploadRecord = {
        storageKey,
        kind: storageKey.split(":", 1)[0] || "file",
        bytes: blob.size,
        mimeType: blob.type || "application/octet-stream",
        status: "uploading",
        progress: 0,
        attempts: (previous?.attempts || 0) + 1,
        error: "",
        objectKey: "",
        createdAt: previous?.createdAt || now,
        updatedAt: now,
    };
    await queueStore.setItem(storageKey, { record, blob } satisfies StoredUpload);
    upsertRecord(record);
    const controller = new AbortController();
    controllers.set(storageKey, controller);
    try {
        const file = await uploadBlobToBackend(storageKey, blob, {
            signal: controller.signal,
            onProgress: (progress) => {
                const current = snapshot.find((item) => item.storageKey === storageKey);
                if (!current || current.status !== "uploading" || current.progress === progress) return;
                upsertRecord({ ...current, progress, updatedAt: Date.now() });
            },
        });
        await queueStore.removeItem(storageKey);
        upsertRecord({ ...record, status: "completed", progress: 100, objectKey: file.objectKey, updatedAt: Date.now() });
        window.setTimeout(() => removeRecord(storageKey), 8000);
        return { stored: true, file };
    } catch (error) {
        const message = controller.signal.aborted ? "上传已取消，作品仍保存在待上传队列" : extractErrorMessage(error, "OSS 保存失败，请重试");
        const failed = { ...record, status: "failed" as const, progress: 0, error: message, updatedAt: Date.now() };
        await queueStore.setItem(storageKey, { record: failed, blob } satisfies StoredUpload);
        upsertRecord(failed);
        return { stored: false, error: message };
    } finally {
        controllers.delete(storageKey);
    }
}

export async function retryMediaUpload(storageKey: string) {
    await initializeQueue();
    const stored = await queueStore.getItem<StoredUpload>(storageKey);
    if (!stored) return null;
    return uploadBlobWithRecovery(storageKey, stored.blob);
}

export async function retryAllMediaUploads() {
    await initializeQueue();
    const failed = snapshot.filter((item) => item.status === "failed");
    return Promise.allSettled(failed.map((item) => retryMediaUpload(item.storageKey)));
}

export function cancelMediaUpload(storageKey: string) {
    controllers.get(storageKey)?.abort();
}

export async function discardMediaUpload(storageKey: string) {
    controllers.get(storageKey)?.abort();
    await queueStore.removeItem(storageKey);
    removeRecord(storageKey);
}

export async function getPendingUploadBlob(storageKey: string) {
    await initializeQueue();
    return (await queueStore.getItem<StoredUpload>(storageKey))?.blob ?? null;
}
