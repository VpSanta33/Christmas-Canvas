import type { CSSProperties } from "react";
import { Link, useNavigate } from "react-router";
import { Keyboard, LogIn, LogOut, Puzzle, Settings2, Shield } from "lucide-react";

import { AnimatedThemeToggler } from "@/components/ui/animated-theme-toggler";
import { isBackendMode } from "@/constant/runtime-config";
import { canvasThemes } from "@/lib/canvas-theme";
import { logout as logoutRequest } from "@/services/api/auth";
import { useAuthStore } from "@/stores/use-auth-store";
import { useConfigStore } from "@/stores/use-config-store";
import { useThemeStore } from "@/stores/use-theme-store";

type UserStatusActionsProps = {
    variant?: "default" | "canvas";
    onOpenShortcuts?: () => void;
    onOpenPlugins?: () => void;
};

export function UserStatusActions({ variant = "default", onOpenShortcuts, onOpenPlugins }: UserStatusActionsProps) {
    const theme = useThemeStore((state) => state.theme);
    const setTheme = useThemeStore((state) => state.setTheme);
    const backendMode = isBackendMode();
    const navigate = useNavigate();
    const user = useAuthStore((state) => state.user);
    const clearSession = useAuthStore((state) => state.clearSession);
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const canvasTheme = canvasThemes[theme];
    const naturalIconClass = "inline-flex size-7 shrink-0 items-center justify-center text-stone-600 transition hover:text-stone-950 dark:text-stone-300 dark:hover:text-white [&_svg]:size-4";
    const iconStyle: CSSProperties | undefined = variant === "canvas" ? { color: canvasTheme.node.text } : undefined;

    const handleLogout = async () => {
        await logoutRequest().catch(() => undefined);
        clearSession();
        navigate("/", { replace: true });
    };

    return (
        <div className="inline-flex shrink-0 items-center gap-1">
            {backendMode && user ? (
                <span
                    className="mr-0.5 hidden h-8 items-center overflow-hidden rounded-md border border-stone-200 bg-white text-xs text-stone-500 sm:inline-flex dark:border-stone-700 dark:bg-stone-900 dark:text-stone-300"
                    style={variant === "canvas" ? { ...iconStyle, background: canvasTheme.toolbar.panel, borderColor: canvasTheme.toolbar.border } : undefined}
                    title={user.email}
                >
                    <span className="max-w-[9rem] truncate px-2">{user.displayName || user.email}</span>
                </span>
            ) : null}
            {onOpenPlugins ? (
                <button type="button" className={naturalIconClass} style={iconStyle} onClick={onOpenPlugins} aria-label="节点插件" title="节点插件">
                    <Puzzle className="size-4" />
                </button>
            ) : null}
            <AnimatedThemeToggler theme={theme} onThemeChange={setTheme} className={naturalIconClass} style={iconStyle} aria-label={theme === "dark" ? "切换到浅色主题" : "切换到深色主题"} title={theme === "dark" ? "切换到浅色主题" : "切换到深色主题"} />
            <button type="button" className={naturalIconClass} style={iconStyle} onClick={() => openConfigDialog(false, "channels")} aria-label="API 与同步设置" title="API 与同步设置">
                <Settings2 className="size-4" />
            </button>
            {onOpenShortcuts ? (
                <button type="button" className={naturalIconClass} style={iconStyle} onClick={onOpenShortcuts} aria-label="快捷键" title="快捷键">
                    <Keyboard className="size-4" />
                </button>
            ) : null}
            {backendMode && !user ? (
                <Link
                    to="/login"
                    className="ml-1 inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md bg-stone-950 px-2.5 text-xs font-semibold text-white shadow-sm transition hover:bg-stone-800 dark:bg-stone-100 dark:text-stone-950 dark:hover:bg-white"
                >
                    <LogIn className="size-3.5" />
                    <span>登录</span>
                </Link>
            ) : null}
            {backendMode && (user?.role === "admin" || user?.role === "operator") ? (
                <Link to="/admin" className={naturalIconClass} style={iconStyle} aria-label="管理后台" title="管理后台">
                    <Shield className="size-4" />
                </Link>
            ) : null}
            {backendMode && user ? (
                <button type="button" className={naturalIconClass} style={iconStyle} onClick={handleLogout} aria-label="退出登录" title="退出登录">
                    <LogOut className="size-4" />
                </button>
            ) : null}
        </div>
    );
}
