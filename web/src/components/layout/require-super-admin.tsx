import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";

import { useAuthStore } from "@/stores/use-auth-store";

export function RequireSuperAdmin({ children }: { children: ReactNode }) {
    const role = useAuthStore((state) => state.user?.role);
    return role === "admin" ? <>{children}</> : <Navigate to="/admin" replace />;
}
