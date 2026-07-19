import { useMemo } from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { nanoid } from "nanoid";

import { API_BASE_URL, isBackendMode } from "@/constant/runtime-config";
import { isViraldanceVideoModel } from "@/lib/viraldance-video";
import { getAuthToken } from "@/stores/use-auth-store";

export type ApiCallFormat = "openai" | "gemini";
export type ModelCapability = "image" | "video" | "text" | "audio";
export type ChannelSource = "personal" | "platform";

export type GenerationPricing = {
    imageQuality: Record<string, number>;
    videoPrices: Record<string, Record<string, number>>;
};

export type ChannelModel = {
    name: string;
    capability: ModelCapability;
    cost?: number;
    enabled?: boolean;
    sortOrder?: number;
    script?: string;
    generationPricing?: GenerationPricing;
};

export type PlatformModelDefaults = Record<ModelCapability, string>;

export const VIDEO_SECONDS_MIN = 1;
export const VIDEO_SECONDS_MAX = 15;
export const VIDEO_SECOND_KEYS = Array.from({ length: VIDEO_SECONDS_MAX - VIDEO_SECONDS_MIN + 1 }, (_, index) => String(index + VIDEO_SECONDS_MIN));

export const defaultGenerationPricing: GenerationPricing = {
    imageQuality: { auto: 0, low: 0, medium: 0, high: 0 },
    videoPrices: Object.fromEntries(["480", "720", "1080"].map((quality) => [quality, Object.fromEntries(VIDEO_SECOND_KEYS.map((seconds) => [seconds, 0]))])),
};

export type ModelChannel = {
    id: string;
    name: string;
    source: ChannelSource;
    baseUrl: string;
    apiKey: string;
    apiFormat: ApiCallFormat;
    models: ChannelModel[];
};

export type AiConfig = {
    channelMode: "remote" | "local";
    baseUrl: string;
    apiKey: string;
    apiFormat: ApiCallFormat;
    channels: ModelChannel[];
    model: string;
    imageModel: string;
    videoModel: string;
    textModel: string;
    audioModel: string;
    audioVoice: string;
    audioFormat: string;
    audioSpeed: string;
    audioInstructions: string;
    videoSeconds: string;
    vquality: string;
    videoGenerateAudio: string;
    videoWatermark: string;
    videoInputMode: string;
    systemPrompt: string;
    models: string[];
    quality: string;
    size: string;
    background: string;
    count: string;
    canvasImageCount: string;
    generationPricing: GenerationPricing;
};

export type WebdavSyncConfig = {
    url: string;
    username: string;
    password: string;
    directory: string;
    lastSyncedAt: string;
};
export type ConfigTabKey = "channels" | "preferences" | "webdav";

export const CONFIG_STORE_KEY = "infinite-canvas:ai_config_store";
const CHANNEL_MODEL_SEPARATOR = "::";
const OPENAI_BASE_URL = "https://api.openai.com";
const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com";

export const defaultConfig: AiConfig = {
    channelMode: "local",
    baseUrl: OPENAI_BASE_URL,
    apiKey: "",
    apiFormat: "openai",
    channels: [
        {
            id: "default",
            name: "默认渠道",
            source: "personal",
            baseUrl: OPENAI_BASE_URL,
            apiKey: "",
            apiFormat: "openai",
            models: [
                { name: "gpt-image-2", capability: "image" },
                { name: "grok-imagine-video", capability: "video" },
                { name: "gpt-5.5", capability: "text" },
                { name: "gpt-4o-mini-tts", capability: "audio" },
            ],
        },
    ],
    model: "default::gpt-image-2",
    imageModel: "default::gpt-image-2",
    videoModel: "default::grok-imagine-video",
    textModel: "default::gpt-5.5",
    audioModel: "default::gpt-4o-mini-tts",
    audioVoice: "alloy",
    audioFormat: "mp3",
    audioSpeed: "1",
    audioInstructions: "",
    videoSeconds: "6",
    vquality: "720",
    videoGenerateAudio: "true",
    videoWatermark: "false",
    videoInputMode: "reference",
    systemPrompt: "",
    models: ["default::gpt-image-2", "default::grok-imagine-video", "default::gpt-5.5", "default::gpt-4o-mini-tts"],
    quality: "auto",
    size: "1:1",
    background: "",
    count: "1",
    canvasImageCount: "3",
    generationPricing: defaultGenerationPricing,
};

export const defaultWebdavSyncConfig: WebdavSyncConfig = {
    url: "",
    username: "",
    password: "",
    directory: "infinite-canvas",
    lastSyncedAt: "",
};

type ConfigStore = {
    config: AiConfig;
    webdav: WebdavSyncConfig;
    backendCatalogLoaded: boolean;
    isConfigOpen: boolean;
    configTab: ConfigTabKey;
    shouldPromptContinue: boolean;
    updateConfig: <K extends keyof AiConfig>(key: K, value: AiConfig[K]) => void;
    replaceBackendChannels: (channels: ModelChannel[], defaults?: Partial<PlatformModelDefaults>, pricing?: Partial<GenerationPricing>) => void;
    updateWebdavConfig: <K extends keyof WebdavSyncConfig>(key: K, value: WebdavSyncConfig[K]) => void;
    isAiConfigReady: (config: AiConfig, model: string) => boolean;
    openConfigDialog: (shouldPromptContinue?: boolean, tab?: ConfigTabKey) => void;
    setConfigDialogOpen: (isOpen: boolean) => void;
    clearPromptContinue: () => void;
};

const VIDEO_KEYWORDS = ["seedance", "viraldance", "video", "sora", "veo", "kling", "wan", "hailuo"];
const AUDIO_KEYWORDS = ["audio", "tts", "speech", "voice", "music", "sound"];
const IMAGE_KEYWORDS = ["seedream", "gpt-image", "image", "dall-e", "dalle", "imagen", "flux", "sdxl", "stable-diffusion", "midjourney"];

/** Best-effort default capability for a freshly fetched model name; user can override in the channel editor. */
export function guessCapability(name: string): ModelCapability {
    const value = name.toLowerCase();
    if (VIDEO_KEYWORDS.some((keyword) => value.includes(keyword))) return "video";
    if (AUDIO_KEYWORDS.some((keyword) => value.includes(keyword))) return "audio";
    if (IMAGE_KEYWORDS.some((keyword) => value.includes(keyword))) return "image";
    return "text";
}

function findChannelModel(config: AiConfig, value: string): { channel: ModelChannel; model: ChannelModel } | null {
    const decoded = decodeChannelModel(value);
    const name = decoded?.model || value;
    const channel = decoded ? config.channels.find((item) => item.id === decoded.channelId) : config.channels.find((item) => item.models.some((model) => model.name === name));
    const model = channel?.models.find((item) => item.enabled !== false && item.name === name);
    return channel && model ? { channel, model } : null;
}

export function modelCapabilityOf(config: AiConfig, value: string): ModelCapability | undefined {
    return findChannelModel(config, value)?.model.capability;
}

export function modelMatchesCapability(config: AiConfig, value: string, capability?: ModelCapability) {
    if (!capability) return true;
    return modelCapabilityOf(config, value) === capability;
}

export function selectableModelsByCapability(config: AiConfig, capability?: ModelCapability) {
    if (!capability) return config.models;
    return config.channels.flatMap((channel) => channel.models.filter((model) => model.enabled !== false && model.capability === capability).map((model) => encodeChannelModel(channel.id, model.name)));
}

/** The user script (if any) attached to a model; empty string means use the system default call. */
export function resolveModelScript(config: AiConfig, value: string) {
    return findChannelModel(config, value)?.model.script?.trim() || "";
}

function isAiConfigReady(config: AiConfig, model: string) {
    const channel = resolveModelChannel(config, model);
    if (channel.source === "platform") return Boolean(isBackendMode() && model.trim() && channel.id && getAuthToken());
    return Boolean(model.trim() && channel.baseUrl.trim() && channel.apiKey.trim());
}

export const useConfigStore = create<ConfigStore>()(
    persist(
        (set) => ({
            config: defaultConfig,
            webdav: defaultWebdavSyncConfig,
            backendCatalogLoaded: false,
            isConfigOpen: false,
            configTab: "channels",
            shouldPromptContinue: false,
            updateConfig: (key, value) =>
                set((state) => ({
                    config: {
                        ...state.config,
                        [key]: value,
                    },
                })),
            replaceBackendChannels: (channels, defaults = {}, pricing) =>
                set((state) => {
                    const platformChannels = channels.map((channel) => createModelChannel({ ...channel, source: "platform", apiKey: "" }));
                    const platformIds = new Set(platformChannels.map((channel) => channel.id));
                    const personalChannels = state.config.channels.filter((channel) => channel.source === "personal" && !(platformIds.has(channel.id) && !channel.apiKey.trim()));
                    const mergedChannels = [...personalChannels, ...platformChannels];
                    const models = modelOptionsFromChannels(mergedChannels);
                    const candidate: AiConfig = { ...state.config, channelMode: "remote", channels: mergedChannels, models };
                    const generationPricing = normalizeGenerationPricing(pricing);
                    const select = (value: string, capability: ModelCapability) => {
                        const options = selectableModelsByCapability(candidate, capability);
                        const current = normalizeModelOptionValue(value, mergedChannels);
                        const platformDefault = normalizeModelOptionValue(defaults[capability], mergedChannels);
                        return (
                            (options.includes(current) && isModelChannelUsable(candidate, current) ? current : "") ||
                            (options.includes(platformDefault) ? platformDefault : "") ||
                            options.find((option) => isModelChannelUsable(candidate, option)) ||
                            options[0] ||
                            ""
                        );
                    };
                    const currentModel = normalizeModelOptionValue(state.config.model, mergedChannels);
                    const genericDefault = normalizeModelOptionValue(defaults.text || defaults.image, mergedChannels);
                    const imageModel = select(state.config.imageModel, "image");
                    const videoModel = select(state.config.videoModel, "video");
                    const textModel = select(state.config.textModel, "text");
                    const audioModel = select(state.config.audioModel, "audio");
                    const videoSelection = configuredVideoSelection(generationPricingForModel({ ...candidate, generationPricing }, videoModel), state.config.vquality, state.config.videoSeconds);
                    return {
                        backendCatalogLoaded: true,
                        config: {
                            ...candidate,
                            model: (isModelChannelUsable(candidate, currentModel) ? currentModel : "") || genericDefault || models.find((option) => isModelChannelUsable(candidate, option)) || models[0] || "",
                            imageModel,
                            videoModel,
                            textModel,
                            audioModel,
                            generationPricing,
                            vquality: videoSelection.quality,
                            videoSeconds: videoSelection.seconds,
                        },
                    };
                }),
            updateWebdavConfig: (key, value) =>
                set((state) => ({
                    webdav: {
                        ...state.webdav,
                        [key]: value,
                    },
                })),
            isAiConfigReady: (config, model) => isAiConfigReady(config, model),
            openConfigDialog: (shouldPromptContinue = false, configTab = "channels") => {
                set({ isConfigOpen: true, shouldPromptContinue, configTab });
            },
            setConfigDialogOpen: (isConfigOpen) => set({ isConfigOpen }),
            clearPromptContinue: () => set({ shouldPromptContinue: false }),
        }),
        {
            name: CONFIG_STORE_KEY,
            partialize: (state) => ({ config: state.config, webdav: state.webdav }),
            merge: (persisted, current) => {
                const persistedState = (persisted || {}) as Partial<ConfigStore>;
                const persistedConfig = (persistedState.config || {}) as Partial<AiConfig>;
                const persistedWebdav = (persistedState.webdav || {}) as Partial<WebdavSyncConfig>;
                const config = { ...defaultConfig, ...persistedConfig };
                if (!Array.isArray(persistedConfig.channels)) config.channels = [];
                const channels = normalizeChannels(config);
                const models = modelOptionsFromChannels(channels);
                const generationPricing = normalizeGenerationPricing(config.generationPricing);
                const imageModel = normalizeModelOptionValue(config.imageModel || config.model, channels);
                const videoModel = normalizeModelOptionValue(config.videoModel, channels);
                const textModel = normalizeModelOptionValue(config.textModel || config.model, channels);
                const audioModel = normalizeModelOptionValue(config.audioModel || defaultConfig.audioModel, channels);
                const normalizedConfig = { ...config, channels, generationPricing };
                const videoSelection = configuredVideoSelection(generationPricingForModel(normalizedConfig, videoModel), config.vquality, config.videoSeconds);
                return {
                    ...current,
                    webdav: { ...defaultWebdavSyncConfig, ...persistedWebdav },
                    config: {
                        ...config,
                        channelMode: "local",
                        apiFormat: normalizeApiFormat(config.apiFormat),
                        channels,
                        models,
                        imageModel,
                        videoModel,
                        textModel,
                        audioModel,
                        audioVoice: config.audioVoice || defaultConfig.audioVoice,
                        audioFormat: config.audioFormat || defaultConfig.audioFormat,
                        audioSpeed: config.audioSpeed || defaultConfig.audioSpeed,
                        audioInstructions: config.audioInstructions || "",
                        videoSeconds: videoSelection.seconds,
                        vquality: videoSelection.quality,
                        videoGenerateAudio: config.videoGenerateAudio || "true",
                        videoWatermark: config.videoWatermark || "false",
                        videoInputMode: config.videoInputMode === "first-last" ? "first-last" : "reference",
                        canvasImageCount: config.canvasImageCount || "3",
                        generationPricing,
                    },
                };
            },
        },
    ),
);

export function useEffectiveConfig() {
    const config = useConfigStore((state) => state.config);
    const backendCatalogLoaded = useConfigStore((state) => state.backendCatalogLoaded);
    const backendMode = isBackendMode();
    return useMemo(() => {
        const personalChannels = config.channels.filter((channel) => channel.source === "personal");
        if (!backendMode) return configForChannels(config, personalChannels, "local");
        if (backendCatalogLoaded) return { ...config, channelMode: "remote" as const };
        return configForChannels(config, personalChannels, "remote");
    }, [backendCatalogLoaded, backendMode, config]);
}

/** Normalize a mixed list of raw model names or model objects into deduped ChannelModel entries. */
export function normalizeChannelModels(models: Array<string | ChannelModel> | undefined): ChannelModel[] {
    const seen = new Set<string>();
    const result: ChannelModel[] = [];
    for (const item of models || []) {
        const name = (typeof item === "string" ? item : item?.name || "").trim();
        if (!name || seen.has(name)) continue;
        seen.add(name);
        const capability = isViraldanceVideoModel(name) ? "video" : typeof item === "string" ? guessCapability(name) : item.capability || guessCapability(name);
        const cost = typeof item === "string" ? 0 : Math.max(0, Math.floor(Number(item.cost) || 0));
        const enabled = typeof item === "string" ? true : item.enabled !== false;
        const sortOrder = typeof item === "string" ? result.length : Math.max(0, Math.floor(Number(item.sortOrder) || 0));
        const script = typeof item === "string" ? undefined : item.script?.trim() || undefined;
        const generationPricing = typeof item === "string" || !item.generationPricing ? undefined : normalizeGenerationPricing(item.generationPricing);
        result.push({ name, capability, cost, enabled, sortOrder, script, generationPricing });
    }
    return result;
}

export function normalizeGenerationPricing(value?: Partial<GenerationPricing>): GenerationPricing {
    if (!value) {
        return {
            imageQuality: { ...defaultGenerationPricing.imageQuality },
            videoPrices: Object.fromEntries(Object.entries(defaultGenerationPricing.videoPrices).map(([quality, prices]) => [quality, { ...prices }])),
        };
    }
    return {
        imageQuality: normalizePointMap(value.imageQuality, defaultGenerationPricing.imageQuality),
        videoPrices: normalizeVideoPrices(value.videoPrices, defaultGenerationPricing.videoPrices),
    };
}

export function generationPricingForModel(config: AiConfig, value: string): GenerationPricing {
    const match = findChannelModel(config, value);
    const pricing = match?.model.generationPricing;
    return normalizeGenerationPricing(pricing ?? (match?.channel.source === "personal" ? defaultGenerationPricing : config.generationPricing));
}

function normalizePointMap(value: Record<string, number> | undefined, defaults: Record<string, number>) {
    if (!value) return { ...defaults };
    return Object.fromEntries(
        Object.entries(value)
            .filter(([key]) => key.trim())
            .map(([key, points]) => [key.toLowerCase().trim().replace(/p$/, ""), Math.max(0, Math.min(1_000_000, Number.isFinite(Number(points)) ? Number(points) : 0))]),
    );
}

function normalizeVideoPrices(value: Record<string, Record<string, number>> | undefined, defaults: Record<string, Record<string, number>>) {
    const source = value ?? defaults;
    return Object.fromEntries(
        Object.entries(source).map(([quality, prices]) => {
            const normalized = normalizePointMap(prices, {});
            return [quality.toLowerCase().trim().replace(/p$/, ""), Object.fromEntries(VIDEO_SECOND_KEYS.map((seconds) => [seconds, normalized[seconds] ?? 0]))];
        }),
    );
}

function configuredVideoSelection(pricing: GenerationPricing, currentQuality: string, currentSeconds: string) {
    const qualities = Object.keys(pricing.videoPrices).sort((a, b) => Number(a) - Number(b) || a.localeCompare(b));
    const normalizedQuality = String(currentQuality || "")
        .trim()
        .toLowerCase()
        .replace(/p$/, "");
    const quality = qualities.includes(normalizedQuality) ? normalizedQuality : qualities[0] || normalizedQuality || "720";
    const durations = Object.keys(pricing.videoPrices[quality] || {}).sort((a, b) => Number(a) - Number(b));
    const normalizedSeconds = String(Math.max(VIDEO_SECONDS_MIN, Math.min(VIDEO_SECONDS_MAX, Math.floor(Number(currentSeconds) || 6))));
    const seconds = durations.includes(normalizedSeconds) ? normalizedSeconds : durations[0] || normalizedSeconds;
    return { quality, seconds };
}

export function createModelChannel(channel?: Partial<ModelChannel>): ModelChannel {
    const apiFormat = normalizeApiFormat(channel?.apiFormat);
    return {
        id: channel?.id?.trim() || nanoid(),
        name: channel?.name?.trim() || "新渠道",
        source: channel?.source === "platform" ? "platform" : "personal",
        baseUrl: channel?.baseUrl?.trim() || defaultBaseUrlForApiFormat(apiFormat),
        apiKey: channel?.apiKey || "",
        apiFormat,
        models: normalizeChannelModels(channel?.models),
    };
}

export function encodeChannelModel(channelId: string, model: string) {
    return `${channelId}${CHANNEL_MODEL_SEPARATOR}${model.trim()}`;
}

export function isChannelModelValue(value: string) {
    return value.includes(CHANNEL_MODEL_SEPARATOR);
}

export function decodeChannelModel(value: string) {
    const index = value.indexOf(CHANNEL_MODEL_SEPARATOR);
    if (index < 0) return null;
    return { channelId: value.slice(0, index), model: value.slice(index + CHANNEL_MODEL_SEPARATOR.length) };
}

export function modelOptionName(value: string) {
    return decodeChannelModel(value)?.model || value;
}

export function modelOptionLabel(config: AiConfig, value: string) {
    const decoded = decodeChannelModel(value);
    if (!decoded) return value;
    const channel = config.channels.find((item) => item.id === decoded.channelId);
    return channel ? `${decoded.model}（${channel.name}）` : decoded.model;
}

export function modelOptionsFromChannels(channels: ModelChannel[]) {
    return uniqueModelOptions(channels.flatMap((channel) => channel.models.filter((model) => model.enabled !== false).map((model) => encodeChannelModel(channel.id, model.name))));
}

export function normalizeModelOptionValue(value: string | undefined, channels: ModelChannel[]) {
    const model = (value || "").trim();
    if (!model) return "";
    const decoded = decodeChannelModel(model);
    if (decoded) {
        const channel = channels.find((item) => item.id === decoded.channelId);
        return channel && channel.models.some((item) => item.enabled !== false && item.name === decoded.model) ? model : "";
    }
    const channel = channels.find((item) => item.models.some((entry) => entry.enabled !== false && entry.name === model));
    return channel ? encodeChannelModel(channel.id, model) : model;
}

export function resolveModelChannel(config: AiConfig, value: string) {
    const decoded = decodeChannelModel(value);
    const model = decoded?.model || value;
    const matched = decoded ? config.channels.find((channel) => channel.id === decoded.channelId) : config.channels.find((channel) => channel.models.some((item) => item.name === model));
    return (
        matched ||
        config.channels[0] ||
        createModelChannel({ id: "default", name: "默认渠道", baseUrl: config.baseUrl, apiKey: config.apiKey, apiFormat: config.apiFormat, models: config.models.map(modelOptionName).map((name) => ({ name, capability: guessCapability(name) })) })
    );
}

export function resolveModelRequestConfig(config: AiConfig, value: string) {
    const channel = resolveModelChannel(config, value);
    // 平台渠道由后端代理并注入管理员保存的密钥；个人渠道始终由浏览器直接请求上游。
    if (isBackendMode() && channel.source === "platform") {
        return {
            ...config,
            model: modelOptionName(value || config.model),
            baseUrl: `${API_BASE_URL}/ai/${channel.id}`,
            apiKey: getAuthToken() || "",
            apiFormat: channel.apiFormat,
        };
    }
    return {
        ...config,
        model: modelOptionName(value || config.model),
        baseUrl: channel.baseUrl,
        apiKey: channel.apiKey,
        apiFormat: channel.apiFormat,
    };
}

function isModelChannelUsable(config: AiConfig, value: string) {
    const decoded = decodeChannelModel(value);
    if (!decoded) return false;
    const channel = config.channels.find((item) => item.id === decoded.channelId);
    return Boolean(channel && (channel.source === "platform" || (channel.baseUrl.trim() && channel.apiKey.trim())));
}

function configForChannels(config: AiConfig, channels: ModelChannel[], channelMode: AiConfig["channelMode"]): AiConfig {
    const models = modelOptionsFromChannels(channels);
    const candidate: AiConfig = { ...config, channelMode, channels, models };
    const select = (value: string, capability: ModelCapability) => {
        const options = selectableModelsByCapability(candidate, capability);
        const current = normalizeModelOptionValue(value, channels);
        return (options.includes(current) ? current : "") || options[0] || "";
    };
    const model = normalizeModelOptionValue(config.model, channels);
    return {
        ...candidate,
        model: (models.includes(model) ? model : "") || models[0] || "",
        imageModel: select(config.imageModel, "image"),
        videoModel: select(config.videoModel, "video"),
        textModel: select(config.textModel, "text"),
        audioModel: select(config.audioModel, "audio"),
    };
}

function normalizeChannels(config: AiConfig) {
    const persistedChannels = Array.isArray(config.channels) ? config.channels : [];
    const channels = persistedChannels.map((channel, index) =>
        createModelChannel({
            ...channel,
            id: channel.id || (index === 0 ? "default" : `channel-${index + 1}`),
            name: channel.name || (index === 0 ? "默认渠道" : `渠道 ${index + 1}`),
            models: normalizeChannelModels(channel.models),
        }),
    );
    if (!channels.length) {
        channels.push(
            createModelChannel({
                id: "default",
                name: "默认渠道",
                baseUrl: config.baseUrl || defaultConfig.baseUrl,
                apiKey: config.apiKey || "",
                apiFormat: config.apiFormat || defaultConfig.apiFormat,
                models: normalizeChannelModels([config.model, config.imageModel, config.videoModel, config.textModel, config.audioModel].map(modelOptionName)),
            }),
        );
    }
    return channels;
}

export function defaultBaseUrlForApiFormat(apiFormat: ApiCallFormat) {
    return apiFormat === "gemini" ? GEMINI_BASE_URL : OPENAI_BASE_URL;
}

function normalizeApiFormat(apiFormat: unknown): ApiCallFormat {
    return apiFormat === "gemini" ? "gemini" : "openai";
}

function uniqueModelOptions(models: string[]) {
    return Array.from(new Set((models || []).map((model) => model.trim()).filter(Boolean)));
}

export function buildApiUrl(baseUrl: string, path: string) {
    let normalizedBaseUrl = baseUrl.trim().replace(/\/+$/, "");
    normalizedBaseUrl = normalizeArkPlanBaseUrl(normalizedBaseUrl);
    const lowerBaseUrl = normalizedBaseUrl.toLowerCase();
    const apiBaseUrl = lowerBaseUrl.endsWith("/v1") || lowerBaseUrl.endsWith("/api/v3") || lowerBaseUrl.endsWith("/api/plan/v3") ? normalizedBaseUrl : `${normalizedBaseUrl}/v1`;
    return `${apiBaseUrl}${path}`;
}

function normalizeArkPlanBaseUrl(baseUrl: string) {
    try {
        const url = new URL(baseUrl);
        const path = url.pathname.replace(/\/+$/, "");
        const lowerPath = path.toLowerCase();
        const arkPlanIndex = lowerPath.indexOf("/api/plan/v3");
        if (arkPlanIndex < 0) return baseUrl;
        const end = arkPlanIndex + "/api/plan/v3".length;
        if (lowerPath.length !== end && lowerPath[end] !== "/") return baseUrl;
        url.pathname = path.slice(0, end);
        url.search = "";
        url.hash = "";
        return url.toString().replace(/\/+$/, "");
    } catch {
        return baseUrl;
    }
}
