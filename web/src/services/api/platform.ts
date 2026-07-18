import { httpClient } from "@/services/http-client";
import { defaultPlatformSettings, usePlatformStore, type PublicPlatformSettings } from "@/stores/use-platform-store";

export async function fetchPublicPlatformSettings(): Promise<PublicPlatformSettings> {
    const { data } = await httpClient.get<Partial<PublicPlatformSettings>>("/platform");
    return { ...defaultPlatformSettings, ...data };
}

export async function syncPlatformSettings(): Promise<void> {
    usePlatformStore.getState().setSettings(await fetchPublicPlatformSettings());
}
