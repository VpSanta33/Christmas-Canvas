import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";

import { isBackendMode } from "@/constant/runtime-config";
import { useAuthStore } from "@/stores/use-auth-store";

// 管理后台守卫：
// - local 模式无后台可言，直接跳回首页；
// - backend 模式下 bootstrap 未完成先返回 null 防闪跳；
// - 未登录跳登录并带 from；已登录但非 admin 跳回首页。
export function RequireAdmin({ children }: { children: ReactNode }) {
    const location = useLocation();
    const token = useAuthStore((state) => state.token);
    const role = useAuthStore((state) => state.user?.role);
    const isReady = useAuthStore((state) => state.isReady);

    if (!isBackendMode()) return <Navigate to="/" replace />;
    if (!isReady) return null;
    if (!token) {
        const from = encodeURIComponent(`${location.pathname}${location.search}`);
        return <Navigate to={`/login?from=${from}`} replace />;
    }
    if (role !== "admin" && role !== "operator") return <Navigate to="/" replace />;
    return <>{children}</>;
}
