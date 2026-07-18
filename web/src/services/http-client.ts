import axios, { type AxiosError, type AxiosRequestConfig } from "axios";

import { API_BASE_URL } from "@/constant/runtime-config";
import { getAuthToken, getRefreshToken, useAuthStore } from "@/stores/use-auth-store";

// backend 模式下所有后端调用共用的 axios 实例。
// - request 拦截器统一注入 Bearer token；
// - response 拦截器遇 401 时尝试用 refreshToken 换新 token 重放一次，失败则清会话并跳登录。
export const httpClient = axios.create({
    baseURL: API_BASE_URL,
    timeout: 60_000,
});

httpClient.interceptors.request.use((config) => {
    const token = getAuthToken();
    if (token) {
        config.headers = config.headers ?? {};
        config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
});

let refreshing: Promise<string | null> | null = null;

async function tryRefresh(): Promise<string | null> {
    const refreshToken = getRefreshToken();
    if (!refreshToken) return null;
    // 用裸 axios 调用刷新端点，避免经过本实例拦截器造成递归。
    try {
        const { data } = await axios.post(`${API_BASE_URL}/auth/refresh`, { refreshToken });
        useAuthStore.getState().setSession({ token: data.token, refreshToken: data.refreshToken, user: data.user });
        return data.token as string;
    } catch {
        return null;
    }
}

function redirectToLogin() {
    useAuthStore.getState().clearSession();
    const { pathname, search } = window.location;
    // 首页是公开入口：首页上的可选社区请求即使未授权，也不应把访客踢到登录页。
    if (pathname !== "/" && pathname !== "/login") {
        const from = encodeURIComponent(`${pathname}${search}`);
        window.location.assign(`/login?from=${from}`);
    }
}

httpClient.interceptors.response.use(
    (response) => response,
    async (error: AxiosError) => {
        const original = error.config as (AxiosRequestConfig & { _retried?: boolean }) | undefined;
        const status = error.response?.status;
        if (status === 401 && original && !original._retried) {
            original._retried = true;
            refreshing = refreshing ?? tryRefresh();
            const newToken = await refreshing;
            refreshing = null;
            if (newToken) {
                original.headers = original.headers ?? {};
                (original.headers as Record<string, string>).Authorization = `Bearer ${newToken}`;
                return httpClient(original);
            }
            redirectToLogin();
        }
        return Promise.reject(error);
    },
);
