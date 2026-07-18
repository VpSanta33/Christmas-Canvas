import { useEffect, useState } from "react";
import { Heart, Play, Sparkles, WandSparkles, Workflow } from "lucide-react";

import { cn } from "@/lib/utils";
import { fetchShowcaseCover, type ContestEntry } from "@/services/api/contest";

export function ShowcaseWorkCard({ entry, featured = false, onOpen }: { entry: ContestEntry; featured?: boolean; onOpen: (id: string) => void }) {
    const [cover, setCover] = useState("");
    useEffect(() => {
        let alive = true;
        let objectUrl = "";
        void fetchShowcaseCover(entry.id)
            .then((blob) => {
                if (!alive) return;
                objectUrl = URL.createObjectURL(blob);
                setCover(objectUrl);
            })
            .catch(() => undefined);
        return () => {
            alive = false;
            if (objectUrl) URL.revokeObjectURL(objectUrl);
        };
    }, [entry.id]);

    const RecipeIcon = entry.recipeType === "skill" ? Sparkles : WandSparkles;
    return (
        <button
            type="button"
            className={cn(
                "group relative min-h-56 overflow-hidden rounded-xl bg-stone-900 text-left ring-1 ring-black/5 transition duration-500 hover:-translate-y-1 hover:shadow-[0_24px_60px_rgba(28,25,23,.2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 dark:ring-white/10",
                featured && "md:col-span-2 md:row-span-2",
            )}
            onClick={() => onOpen(entry.id)}
            aria-label={`查看用户作品：${entry.title}`}
        >
            {cover ? (
                <img src={cover} alt={entry.title} className="absolute inset-0 size-full object-cover transition duration-700 ease-out group-hover:scale-[1.035]" />
            ) : (
                <div className="absolute inset-0 animate-pulse bg-gradient-to-br from-stone-800 to-stone-950" />
            )}
            <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/20 to-black/10" />
            <div className="absolute inset-x-0 top-0 flex items-start justify-between gap-3 p-3.5">
                <span className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-black/35 px-2.5 py-1 text-[11px] font-medium text-white backdrop-blur-md">
                    <RecipeIcon className="size-3" />
                    {entry.recipeType === "skill" ? "Skill 作品" : "提示词作品"}
                </span>
                {entry.hasWorkflow ? (
                    <span className="inline-flex items-center gap-1 rounded-full border border-white/15 bg-black/35 px-2.5 py-1 text-[11px] text-white backdrop-blur-md">
                        <Workflow className="size-3" />
                        工作流
                    </span>
                ) : null}
            </div>
            <span className="absolute left-1/2 top-1/2 grid size-11 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-white/90 text-stone-950 opacity-0 shadow-xl transition duration-300 group-hover:scale-105 group-hover:opacity-100">
                <Play className="ml-0.5 size-4 fill-current" />
            </span>
            <div className="absolute inset-x-0 bottom-0 p-4 text-white sm:p-5">
                <div className="mb-2 flex items-center justify-between gap-3 text-xs text-white/65">
                    <span className="truncate">{entry.authorName}</span>
                    <span className="inline-flex shrink-0 items-center gap-1">
                        <Heart className="size-3.5" />
                        {entry.likes}
                    </span>
                </div>
                <h3 className={cn("font-semibold leading-snug", featured ? "text-xl sm:text-2xl" : "text-base")}>{entry.title}</h3>
                {featured ? <p className="mt-2 line-clamp-2 max-w-xl text-sm leading-6 text-white/65">{entry.description || entry.recipePreview}</p> : null}
            </div>
        </button>
    );
}
