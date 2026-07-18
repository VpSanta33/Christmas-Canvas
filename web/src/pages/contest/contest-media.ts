import { useEffect, useState } from "react";

import { fetchContestCover, fetchContestVideo } from "@/services/api/contest";

export function useContestObjectUrl(entryId: string | null, kind: "cover" | "video") {
    const [loaded, setLoaded] = useState({ id: "", url: "" });

    useEffect(() => {
        if (!entryId) return;
        let alive = true;
        let objectUrl = "";
        const fetcher = kind === "cover" ? fetchContestCover : fetchContestVideo;
        void fetcher(entryId)
            .then((blob) => {
                if (!alive) return;
                objectUrl = URL.createObjectURL(blob);
                setLoaded({ id: entryId, url: objectUrl });
            })
            .catch(() => alive && setLoaded({ id: entryId, url: "" }));
        return () => {
            alive = false;
            if (objectUrl) URL.revokeObjectURL(objectUrl);
        };
    }, [entryId, kind]);

    return loaded.id === entryId ? loaded.url : "";
}

export async function captureVideoCover(file: File): Promise<Blob> {
    const sourceUrl = URL.createObjectURL(file);
    try {
        const video = document.createElement("video");
        video.preload = "metadata";
        video.muted = true;
        video.playsInline = true;
        video.src = sourceUrl;
        await waitForVideo(video, "loadedmetadata");
        if (Number.isFinite(video.duration) && video.duration > 0) {
            video.currentTime = Math.min(0.25, video.duration / 3);
            await waitForVideo(video, "seeked");
        }
        const sourceWidth = video.videoWidth || 1280;
        const sourceHeight = video.videoHeight || 720;
        const maxWidth = 960;
        const scale = Math.min(1, maxWidth / sourceWidth);
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(sourceWidth * scale));
        canvas.height = Math.max(1, Math.round(sourceHeight * scale));
        const context = canvas.getContext("2d");
        if (!context) throw new Error("无法生成视频封面");
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        return await new Promise<Blob>((resolve, reject) =>
            canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("无法生成视频封面"))), "image/jpeg", 0.84),
        );
    } finally {
        URL.revokeObjectURL(sourceUrl);
    }
}

function waitForVideo(video: HTMLVideoElement, event: "loadedmetadata" | "seeked") {
    return new Promise<void>((resolve, reject) => {
        const onReady = () => {
            cleanup();
            resolve();
        };
        const onError = () => {
            cleanup();
            reject(new Error("无法读取视频"));
        };
        const cleanup = () => {
            video.removeEventListener(event, onReady);
            video.removeEventListener("error", onError);
        };
        video.addEventListener(event, onReady, { once: true });
        video.addEventListener("error", onError, { once: true });
    });
}
