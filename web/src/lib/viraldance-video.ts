import type { ReferenceAudio, ReferenceVideo } from "@/types/media";

export type ViraldanceVariant = "431" | "900";

export type ViraldanceProfile = {
    variant: ViraldanceVariant;
    maxImages: number;
    maxVideos: number;
    maxAudios: number;
    ratios: readonly string[];
};

export type ViraldancePayloadInput = {
    model: string;
    prompt: string;
    duration: string;
    size: string;
    imageUrls: string[];
    videoUrls: string[];
    audioUrls: string[];
    imageMode?: "reference" | "first-last";
};

export type ViraldancePayload = {
    model: string;
    prompt: string;
    duration: number;
    aspect_ratio?: string;
    size?: string;
    resolution?: string;
    image_url?: string;
    image_urls?: string[];
    start_image_url?: string;
    end_image_url?: string;
    video_url?: string;
    video_reference?: Array<{ url: string }>;
    audio_url?: string;
};

const profiles: Record<ViraldanceVariant, ViraldanceProfile> = {
    "431": { variant: "431", maxImages: 4, maxVideos: 3, maxAudios: 1, ratios: ["16:9", "9:16", "1:1"] },
    "900": { variant: "900", maxImages: 9, maxVideos: 0, maxAudios: 0, ratios: ["16:9", "9:16"] },
};

const ratioSizes: Record<string, string> = {
    "16:9": "1280x720",
    "9:16": "720x1280",
    "1:1": "960x960",
};

export function viraldanceProfile(model: string): ViraldanceProfile | null {
    const normalized =
        model
            .split("::")
            .at(-1)
            ?.toLowerCase()
            .replace(/[^a-z0-9]/g, "") || "";
    if (normalized.includes("viraldance431")) return profiles["431"];
    if (normalized.includes("viraldance900")) return profiles["900"];
    return null;
}

export function isViraldanceVideoModel(model: string) {
    return viraldanceProfile(model) !== null;
}

export function normalizeViraldanceDuration(value: string) {
    const duration = Math.floor(Number(value) || 5);
    return Math.max(4, Math.min(15, duration));
}

export function normalizeViraldanceRatio(value: string, model: string) {
    const profile = viraldanceProfile(model) || profiles["431"];
    if (profile.ratios.includes(value)) return value;
    const dimensions = value.match(/^(\d+)x(\d+)$/);
    if (!dimensions) return "16:9";
    const width = Number(dimensions[1]);
    const height = Number(dimensions[2]);
    if (!width || !height) return "16:9";
    const ratio = width / height;
    return profile.ratios.reduce((best, candidate) => {
        const [candidateWidth, candidateHeight] = candidate.split(":").map(Number);
        const [bestWidth, bestHeight] = best.split(":").map(Number);
        return Math.abs(candidateWidth / candidateHeight - ratio) < Math.abs(bestWidth / bestHeight - ratio) ? candidate : best;
    }, profile.ratios[0]);
}

export function viraldanceSizeForRatio(ratio: string, model: string) {
    return ratioSizes[normalizeViraldanceRatio(ratio, model)] || ratioSizes["16:9"];
}

export function viraldanceReferenceError(model: string, imageCount: number, videos: ReferenceVideo[], audios: ReferenceAudio[]) {
    const profile = viraldanceProfile(model);
    if (!profile) return "";
    if (imageCount > profile.maxImages) return `${model} 最多支持 ${profile.maxImages} 张参考图`;
    if (videos.length > profile.maxVideos) return profile.maxVideos ? `${model} 最多支持 ${profile.maxVideos} 个参考视频` : `${model} 不支持参考视频`;
    if (audios.length > profile.maxAudios) return profile.maxAudios ? `${model} 最多支持 ${profile.maxAudios} 个参考音频` : `${model} 不支持参考音频`;

    const totalVideoBytes = videos.reduce((total, video) => total + Math.max(0, video.bytes || 0), 0);
    if (totalVideoBytes > 200 * 1024 * 1024) return `${model} 的参考视频总大小不能超过 200MB`;
    const totalVideoDuration = videos.reduce((total, video) => total + Math.max(0, video.durationMs || 0), 0);
    if (totalVideoDuration > 15_000) return `${model} 的参考视频总时长不能超过 15 秒`;
    if (audios.some((audio) => audio.durationMs && audio.durationMs > 15_000)) return `${model} 的参考音频时长不能超过 15 秒`;
    return "";
}

export function buildViraldancePayload(input: ViraldancePayloadInput): ViraldancePayload {
    const profile = viraldanceProfile(input.model);
    if (!profile) throw new Error(`不支持的 Viraldance 模型：${input.model}`);
    const prompt = input.prompt.trim();
    if (!prompt) throw new Error("请输入视频提示词");
    if (prompt.length > 5000) throw new Error("Viraldance 提示词不能超过 5000 个字符");

    const ratio = normalizeViraldanceRatio(input.size, input.model);
    const payload: ViraldancePayload = {
        model: input.model,
        prompt,
        duration: normalizeViraldanceDuration(input.duration),
    };

    if (profile.variant === "900") {
        payload.aspect_ratio = ratio;
        payload.size = viraldanceSizeForRatio(ratio, input.model);
    } else if (/^\d+x\d+$/.test(input.size)) {
        payload.size = viraldanceSizeForRatio(input.size, input.model);
        payload.resolution = "720p";
    } else {
        payload.aspect_ratio = ratio;
        payload.resolution = "720p";
    }

    if (input.imageMode === "first-last") {
        if (profile.variant !== "431") throw new Error(`${input.model} 不支持首尾帧模式`);
        if (input.imageUrls.length !== 2) throw new Error("Viraldance 首尾帧模式需要恰好两张参考图");
        payload.start_image_url = input.imageUrls[0];
        payload.end_image_url = input.imageUrls[1];
    } else if (input.imageUrls.length === 1) payload.image_url = input.imageUrls[0];
    else if (input.imageUrls.length > 1) payload.image_urls = input.imageUrls;

    if (profile.variant === "431") {
        if (input.videoUrls.length === 1) payload.video_url = input.videoUrls[0];
        else if (input.videoUrls.length > 1) payload.video_reference = input.videoUrls.map((url) => ({ url }));
        if (input.audioUrls.length) payload.audio_url = input.audioUrls[0];
    }
    return payload;
}
