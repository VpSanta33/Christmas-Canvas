import { isSeedanceVideoConfig, normalizeSeedanceDuration, normalizeSeedanceResolution } from "@/lib/seedance-video";
import { normalizeViraldanceDuration, viraldanceProfile } from "@/lib/viraldance-video";
import { decodeChannelModel, generationPricingForModel, modelCapabilityOf, modelOptionName, VIDEO_SECONDS_MAX, VIDEO_SECONDS_MIN, type AiConfig } from "@/stores/use-config-store";

export function modelGenerationCost(config: AiConfig, value: string): number {
    const decoded = decodeChannelModel(value);
    const name = decoded?.model || modelOptionName(value);
    const channel = decoded ? config.channels.find((item) => item.id === decoded.channelId) : config.channels.find((item) => item.models.some((model) => model.name === name));
    const model = channel?.models.find((item) => item.name === name);
    return Math.max(0, Math.floor(Number(model?.cost) || 0));
}

export function estimatedGenerationCost(config: AiConfig, value: string, requests = 1): number {
    const baseCost = modelGenerationCost(config, value);
    const pricing = generationPricingForModel(config, value);

    const units = Math.max(1, Math.floor(requests) || 1);
    const capability = modelCapabilityOf(config, value);
    if (capability === "image") {
        const points = pointFor(pricing.imageQuality, normalizeImageQuality(config.quality));
        return Math.ceil((baseCost + points) * units);
    } else if (capability === "video") {
        const parameters = normalizedVideoParameters(config, value);
        return Math.ceil(baseCost + videoPrice(pricing.videoPrices, parameters.quality, parameters.seconds));
    }
    return Math.ceil(baseCost * units);
}

function pointFor(values: Record<string, number> | undefined, key: string): number {
    const value = Number(values?.[key]);
    return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function videoPrice(values: Record<string, Record<string, number>>, quality: string, seconds: string): number {
    const prices = values[quality] ?? values["720"];
    if (!prices) return highestVideoPrice(values);
    const exact = Number(prices[seconds]);
    if (Number.isFinite(exact)) return Math.max(0, exact);
    return Math.max(0, ...Object.values(prices).map(Number).filter(Number.isFinite));
}

function highestVideoPrice(values: Record<string, Record<string, number>>): number {
    return Math.max(
        0,
        ...Object.values(values)
            .flatMap((prices) => Object.values(prices))
            .map(Number)
            .filter(Number.isFinite),
    );
}

export function configuredVideoQualities(config: AiConfig, model = config.model || config.videoModel): string[] {
    return Object.keys(generationPricingForModel(config, model).videoPrices).sort((a, b) => Number(a) - Number(b));
}

export function configuredVideoDurations(config: AiConfig, quality?: string, model = config.model || config.videoModel): number[] {
    const normalized = normalizeVideoQuality(quality || config.vquality);
    const videoPrices = generationPricingForModel(config, model).videoPrices;
    const prices = videoPrices[normalized] ?? videoPrices["720"] ?? {};
    return Object.keys(prices)
        .map(Number)
        .filter((value) => Number.isInteger(value) && (value === -1 || value > 0))
        .sort((a, b) => a - b);
}

function normalizeImageQuality(value: string): string {
    const quality = value.trim().toLowerCase();
    if (quality === "hd" || quality === "4k") return "high";
    if (quality === "standard" || quality === "2k") return "medium";
    if (quality === "1k" || quality === "512") return "low";
    return quality || "auto";
}

function normalizeVideoQuality(value: string): string {
    const quality = value.trim().toLowerCase().replace(/p$/, "");
    if (quality === "low") return "480";
    if (!quality || quality === "auto" || quality === "medium" || quality === "high") return "720";
    return quality;
}

function normalizedVideoParameters(config: AiConfig, value: string): { quality: string; seconds: string } {
    const workbenchSeconds = normalizeWorkbenchVideoSeconds(config.videoSeconds);
    if (viraldanceProfile(modelOptionName(value))) {
        return {
            quality: "720",
            seconds: String(normalizeViraldanceDuration(workbenchSeconds)),
        };
    }
    if (!isSeedanceVideoConfig({ ...config, model: value, videoModel: value })) {
        return {
            quality: normalizeVideoQuality(config.vquality),
            seconds: normalizeGenericVideoSeconds(workbenchSeconds),
        };
    }
    return {
        quality: normalizeVideoQuality(normalizeSeedanceResolution(config.vquality, modelOptionName(value))),
        seconds: String(normalizeSeedanceDuration(workbenchSeconds)),
    };
}

function normalizeWorkbenchVideoSeconds(value: string): string {
    return normalizeGenericVideoSeconds(value);
}

function normalizeGenericVideoSeconds(value: string): string {
    const seconds = Math.floor(Number(value) || 6);
    return String(Math.max(VIDEO_SECONDS_MIN, Math.min(VIDEO_SECONDS_MAX, seconds)));
}
