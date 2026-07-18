import { Drawer } from "antd";
import { Link } from "react-router-dom";
import { Trophy } from "lucide-react";

import { isBackendMode } from "@/constant/runtime-config";
import { navigationTools, type NavigationToolSlug } from "@/constant/navigation-tools";
import { cn } from "@/lib/utils";

type MobileNavDrawerProps = {
    open: boolean;
    activeToolSlug?: NavigationToolSlug;
    onClose: () => void;
};

export function MobileNavDrawer({ open, activeToolSlug, onClose }: MobileNavDrawerProps) {
    return (
        <Drawer title="导航" placement="left" size={280} open={open} onClose={onClose} className="xl:hidden">
            <div className="space-y-1">
                {isBackendMode() ? (
                    <Link
                        to="/contest"
                        onClick={onClose}
                        className="mb-2 flex items-center gap-3 rounded-lg border border-amber-300/70 bg-amber-50 px-3 py-3 text-base font-medium text-amber-800 dark:border-amber-500/35 dark:bg-amber-500/10 dark:text-amber-300"
                    >
                        <Trophy className="size-5" />
                        <span>创作者大赛</span>
                    </Link>
                ) : null}
                {navigationTools.map((tool) => {
                    const Icon = tool.icon;
                    const active = tool.slug === activeToolSlug;
                    return (
                        <Link
                            key={tool.slug}
                            to={`/${tool.slug}`}
                            onClick={onClose}
                            className={cn(
                                "flex items-center gap-3 rounded-lg px-3 py-3 text-base transition",
                                active ? "bg-stone-100 font-medium text-stone-950 dark:bg-stone-800 dark:text-stone-100" : "text-stone-600 hover:bg-stone-100 hover:text-stone-950 dark:text-stone-300 dark:hover:bg-stone-800 dark:hover:text-stone-100",
                            )}
                        >
                            <Icon className="size-5" />
                            <span>{tool.label}</span>
                        </Link>
                    );
                })}
            </div>
        </Drawer>
    );
}
