import { httpClient } from "@/services/http-client";
import { createModelChannel, defaultGenerationPricing, normalizeGenerationPricing, useConfigStore, type ApiCallFormat, type ChannelModel, type GenerationPricing, type PlatformModelDefaults } from "@/stores/use-config-store";

export type PublicChannel = {
    id: string;
    name: string;
    apiFormat: ApiCallFormat;
    models: ChannelModel[];
    enabled: boolean;
};

export type PublicModelCatalog = {
    channels: PublicChannel[];
    defaults: PlatformModelDefaults;
    generationPricing: GenerationPricing;
};

const emptyDefaults: PlatformModelDefaults = { image: "", video: "", text: "", audio: "" };

export async function fetchPublicChannels(): Promise<PublicModelCatalog> {
    const { data } = await httpClient.get<Partial<PublicModelCatalog>>("/channels");
    return { channels: data.channels ?? [], defaults: { ...emptyDefaults, ...data.defaults }, generationPricing: normalizeGenerationPricing(data.generationPricing || defaultGenerationPricing) };
}

export async function syncBackendChannels(): Promise<void> {
    const store = useConfigStore.getState();
    try {
        const catalog = await fetchPublicChannels();
        const channels = catalog.channels.filter((channel) => channel.enabled).map((channel) => createModelChannel({ ...channel, apiKey: "" }));
        store.replaceBackendChannels(channels, catalog.defaults, catalog.generationPricing);
    } catch (error) {
        // 平台目录失败时保持空目录，绝不回退到浏览器本地保存的渠道或密钥。
        store.replaceBackendChannels([]);
        throw error;
    }
}
