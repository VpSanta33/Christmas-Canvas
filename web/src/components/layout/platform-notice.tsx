import { AlertTriangle, Megaphone } from "lucide-react";

import { usePlatformStore } from "@/stores/use-platform-store";

export function PlatformNotice() {
    const settings = usePlatformStore((state) => state.settings);
    const message = settings.maintenanceEnabled ? settings.maintenanceNotice || "平台正在维护，部分能力可能暂不可用。" : settings.announcement;
    if (!message) return null;
    const Icon = settings.maintenanceEnabled ? AlertTriangle : Megaphone;
    return (
        <div
            className={
                settings.maintenanceEnabled
                    ? "border-b border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200"
                    : "border-b border-stone-200 bg-stone-100 text-stone-600 dark:border-stone-800 dark:bg-stone-900 dark:text-stone-300"
            }
        >
            <div className="mx-auto flex min-h-9 max-w-7xl items-center justify-center gap-2 px-5 py-1.5 text-center text-xs">
                <Icon className="size-3.5 shrink-0" />
                <span>{message}</span>
            </div>
        </div>
    );
}
