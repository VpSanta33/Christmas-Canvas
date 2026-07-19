import type { ReactNode } from "react";
import { ArrowLeft, Cloud, LayoutDashboard, Mail, Megaphone, Settings2, ShieldCheck, Trophy, Users } from "lucide-react";
import { Link, useLocation } from "react-router-dom";

import { cn } from "@/lib/utils";
import { useAuthStore } from "@/stores/use-auth-store";

const navItems = [
    { to: "/admin", label: "概览", icon: LayoutDashboard, exact: true },
    { to: "/admin/users", label: "用户管理", icon: Users, exact: false, superOnly: true },
    { to: "/admin/contest", label: "大赛审核", icon: Trophy, exact: false },
    { to: "/admin/platform", label: "站点设置", icon: Settings2, exact: false, superOnly: true },
    { to: "/admin/announcements", label: "公告管理", icon: Megaphone, exact: false, superOnly: true },
    { to: "/admin/email", label: "邮箱服务", icon: Mail, exact: false, superOnly: true },
    { to: "/admin/storage", label: "存储配置", icon: Cloud, exact: false, superOnly: true },
    { to: "/admin/security", label: "安全审计", icon: ShieldCheck, exact: false, superOnly: true },
];

export default function AdminLayout({ children }: { children: ReactNode }) {
    const { pathname } = useLocation();
    const role = useAuthStore((state) => state.user?.role);
    return (
        <div className="flex h-dvh overflow-hidden bg-background text-foreground">
            <aside className="flex w-56 shrink-0 flex-col border-r border-stone-200 bg-background/95 dark:border-stone-800">
                <div className="flex h-14 items-center gap-2 px-5 text-sm font-semibold text-stone-950 dark:text-stone-100">
                    <span
                        className="size-5 shrink-0 bg-amber-500"
                        style={{
                            mask: "url(/logo.svg) center / contain no-repeat",
                            WebkitMask: "url(/logo.svg) center / contain no-repeat",
                        }}
                    />
                    管理后台
                </div>
                <nav className="flex flex-1 flex-col gap-1 overflow-y-auto px-3 py-3">
                    {navItems
                        .filter((item) => !item.superOnly || role === "admin")
                        .map((item) => {
                            const Icon = item.icon;
                            const active = item.exact ? pathname === item.to : pathname.startsWith(item.to);
                            return (
                                <Link
                                    key={item.to}
                                    to={item.to}
                                    className={cn(
                                        "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition",
                                        active
                                            ? "bg-stone-100 font-medium text-stone-950 dark:bg-stone-800 dark:text-stone-100"
                                            : "text-stone-500 hover:bg-stone-50 hover:text-stone-950 dark:text-stone-400 dark:hover:bg-stone-900 dark:hover:text-stone-100",
                                    )}
                                >
                                    <Icon className="size-4" />
                                    {item.label}
                                </Link>
                            );
                        })}
                </nav>
                <div className="border-t border-stone-200 p-3 dark:border-stone-800">
                    <Link to="/" className="flex items-center gap-2.5 rounded-md px-3 py-2 text-sm text-stone-500 transition hover:bg-stone-50 hover:text-stone-950 dark:text-stone-400 dark:hover:bg-stone-900 dark:hover:text-stone-100">
                        <ArrowLeft className="size-4" />
                        返回画布
                    </Link>
                </div>
            </aside>
            <main className="min-w-0 flex-1 overflow-y-auto">
                <div className="mx-auto max-w-6xl px-8 py-8">{children}</div>
            </main>
        </div>
    );
}
