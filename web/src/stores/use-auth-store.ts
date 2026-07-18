import { create } from "zustand";
import { persist } from "zustand/middleware";

// backend 模式下的认证会话。token 持久化到 localStorage，
// 供非 React 环境（axios 拦截器）通过 getAuthToken() 读取。
// local 模式完全不使用本 store，行为零变化。

export type AuthUser = {
    id: string;
    email: string;
    emailVerified: boolean;
    displayName: string;
    role: string;
    credits: number;
};

type AuthState = {
    token: string | null;
    refreshToken: string | null;
    user: AuthUser | null;
    // bootstrap 是否完成：backend 模式下用于避免鉴权判定前的路由闪跳。
    isReady: boolean;
    setSession: (payload: { token: string; refreshToken?: string | null; user: AuthUser | null }) => void;
    setUser: (user: AuthUser | null) => void;
    setCredits: (credits: number) => void;
    setReady: (ready: boolean) => void;
    clearSession: () => void;
};

const STORAGE_KEY = "infinite-canvas:auth";

export const useAuthStore = create<AuthState>()(
    persist(
        (set) => ({
            token: null,
            refreshToken: null,
            user: null,
            isReady: false,
            setSession: ({ token, refreshToken, user }) => set({ token, refreshToken: refreshToken ?? null, user }),
            setUser: (user) => set({ user }),
            setCredits: (credits) => set((state) => (state.user ? { user: { ...state.user, credits } } : {})),
            setReady: (ready) => set({ isReady: ready }),
            clearSession: () => set({ token: null, refreshToken: null, user: null }),
        }),
        {
            name: STORAGE_KEY,
            // 只持久化 token 与用户，isReady 每次启动重置为 false 走 bootstrap。
            partialize: (state) => ({ token: state.token, refreshToken: state.refreshToken, user: state.user }),
        },
    ),
);

// 供 axios 拦截器等非 React 代码读取当前 token / refreshToken。
export function getAuthToken(): string | null {
    return useAuthStore.getState().token;
}

export function getRefreshToken(): string | null {
    return useAuthStore.getState().refreshToken;
}
