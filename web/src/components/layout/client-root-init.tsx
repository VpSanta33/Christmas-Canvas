import type { ReactNode } from "react";
import { useEffect, useRef } from "react";
import { App } from "antd";

import { isBackendMode } from "@/constant/runtime-config";
import { fetchMe } from "@/services/api/auth";
import { syncPlatformSettings } from "@/services/api/platform";
import { createModelChannel, useConfigStore } from "@/stores/use-config-store";
import { useAuthStore } from "@/stores/use-auth-store";

export function ClientRootInit({ children }: { children: ReactNode }) {
    const { message } = App.useApp();
    const handledConfigParams = useRef(false);
    const bootstrapped = useRef(false);
    const updateConfig = useConfigStore((state) => state.updateConfig);
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);

    // backend 模式只负责账号与平台站点信息；模型渠道始终由用户在浏览器中维护。
    useEffect(() => {
        if (bootstrapped.current) return;
        bootstrapped.current = true;
        const { token, setUser, clearSession, setReady } = useAuthStore.getState();
        if (!isBackendMode()) {
            setReady(true);
            return;
        }
        const platformRequest = syncPlatformSettings().catch(() => undefined);
        const sessionRequest = token
            ? fetchMe()
                  .then(setUser)
                  .catch(() => clearSession())
            : Promise.resolve();
        void Promise.all([platformRequest, sessionRequest]).finally(() => setReady(true));
    }, [message]);

    useEffect(() => {
        if (handledConfigParams.current) return;
        const searchParams = new URLSearchParams(window.location.search);
        const baseUrl = searchParams.get("baseUrl") || searchParams.get("baseurl");
        const apiKey = searchParams.get("apiKey") || searchParams.get("apikey");
        if (!baseUrl && !apiKey) return;
        handledConfigParams.current = true;
        searchParams.delete("baseUrl");
        searchParams.delete("baseurl");
        searchParams.delete("apiKey");
        searchParams.delete("apikey");
        window.history.replaceState(null, "", `${window.location.pathname}${searchParams.size ? `?${searchParams}` : ""}${window.location.hash}`);
        const currentConfig = useConfigStore.getState().config;
        const firstPersonalChannel = currentConfig.channels.find((channel) => channel.source === "personal");
        updateConfig(
            "channels",
            firstPersonalChannel
                ? currentConfig.channels.map((channel) =>
                      channel.id === firstPersonalChannel.id
                          ? {
                                ...channel,
                                ...(baseUrl ? { baseUrl } : {}),
                                ...(apiKey ? { apiKey } : {}),
                            }
                          : channel,
                  )
                : [createModelChannel({ name: "个人 API", source: "personal", baseUrl: baseUrl || undefined, apiKey: apiKey || "" }), ...currentConfig.channels],
        );
        if (baseUrl) updateConfig("baseUrl", baseUrl);
        if (apiKey) updateConfig("apiKey", apiKey);
        openConfigDialog(false);
        message.success("已导入本地直连配置");
    }, [message, openConfigDialog, updateConfig]);

    return <>{children}</>;
}
