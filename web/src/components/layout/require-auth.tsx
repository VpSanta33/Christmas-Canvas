import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";

import { isBackendMode } from "@/constant/runtime-config";
import { useAuthStore } from "@/stores/use-auth-store";

// 路由守卫：
// - local 模式直接放行，保留「无账号即可用」的离线体验；
// - 首页始终公开，backend 模式未登录也能先浏览创作入口；
// - 其他页面在 bootstrap 未完成时先返回 null，无 token 再跳登录并带 from。
export function RequireAuth({ children }: { children: ReactNode }) {
    const location = useLocation();
    const token = useAuthStore((state) => state.token);
    const isReady = useAuthStore((state) => state.isReady);

    if (!isBackendMode() || location.pathname === "/") return <>{children}</>;
    if (!isReady) return null;
    if (!token) {
        const from = encodeURIComponent(`${location.pathname}${location.search}`);
        return <Navigate to={`/login?from=${from}`} replace />;
    }
    return <>{children}</>;
}
