import type { ReactNode } from "react";
import { useEffect, useRef } from "react";
import { App } from "antd";

import { isBackendMode } from "@/constant/runtime-config";
import { fetchMe } from "@/services/api/auth";
import { syncBackendChannels } from "@/services/api/channels";
import { syncPlatformSettings } from "@/services/api/platform";
import { createModelChannel, useConfigStore } from "@/stores/use-config-store";
import { useAuthStore } from "@/stores/use-auth-store";

export function ClientRootInit({ children }: { children: ReactNode }) {
    const { message } = App.useApp();
    const handledConfigParams = useRef(false);
    const bootstrapped = useRef(false);
    const updateConfig = useConfigStore((state) => state.updateConfig);
    const config = useConfigStore((state) => state.config);
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);

    // backend 模式启动引导：模型目录是公开只读数据，访客也要加载；
    // 登录态校验与目录请求并行，避免普通用户退回浏览器本地渠道。
    useEffect(() => {
        if (bootstrapped.current) return;
        bootstrapped.current = true;
        const { token, setUser, clearSession, setReady } = useAuthStore.getState();
        if (!isBackendMode()) {
            setReady(true);
            return;
        }
        const catalogRequest = syncBackendChannels().catch(() => message.warning("平台模型加载失败，请稍后刷新"));
        const platformRequest = syncPlatformSettings().catch(() => undefined);
        const sessionRequest = token
            ? fetchMe()
                  .then(setUser)
                  .catch(() => clearSession())
            : Promise.resolve();
        void Promise.all([catalogRequest, platformRequest, sessionRequest]).finally(() => setReady(true));
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
        if (isBackendMode()) {
            message.warning("平台模型由管理员统一配置，已忽略本地接口参数");
            return;
        }
        const firstChannel = config.channels[0];
        updateConfig(
            "channels",
            firstChannel
                ? config.channels.map((channel, index) =>
                      index === 0
                          ? {
                                ...channel,
                                ...(baseUrl ? { baseUrl } : {}),
                                ...(apiKey ? { apiKey } : {}),
                            }
                          : channel,
                  )
                : [createModelChannel({ id: "default", name: "默认渠道", baseUrl: baseUrl || undefined, apiKey: apiKey || "" })],
        );
        if (baseUrl) updateConfig("baseUrl", baseUrl);
        if (apiKey) updateConfig("apiKey", apiKey);
        openConfigDialog(false);
        message.success("已导入本地直连配置");
    }, [config.channels, message, openConfigDialog, updateConfig]);

    return <>{children}</>;
}
