import { useState } from "react";
import { App } from "antd";
import { Bookmark, BookmarkPlus, Heart, Play, Sparkles, WandSparkles, Workflow } from "lucide-react";

import { fetchContestEntry, type ContestEntry } from "@/services/api/contest";
import { useAssetStore } from "@/stores/use-asset-store";

import { useContestObjectUrl } from "./contest-media";

type ContestEntryCardProps = {
    entry: ContestEntry;
    rank?: number;
    onOpen: (id: string) => void;
    onLike: (entry: ContestEntry) => void;
    onFavorite: (entry: ContestEntry) => void;
    onUse: (entry: ContestEntry) => void;
    onAuthor: (authorId: string) => void;
};

const STATUS_BADGE: Record<ContestEntry["status"], { label: string; className: string } | null> = {
    approved: { label: "已通过", className: "bg-emerald-500/90 text-white" },
    pending: { label: "审核中", className: "bg-amber-400/90 text-stone-950" },
    rejected: { label: "已拒绝", className: "bg-rose-500/90 text-white" },
};

export function ContestEntryCard({ entry, rank, onOpen, onLike, onFavorite, onUse, onAuthor }: ContestEntryCardProps) {
    const { message } = App.useApp();
    const addAsset = useAssetStore((state) => state.addAsset);
    const coverUrl = useContestObjectUrl(entry.id, "cover");
    const RecipeIcon = entry.recipeType === "skill" ? Sparkles : WandSparkles;
    const topRank = rank && rank <= 3 ? rank : undefined;
    const statusBadge = entry.mine ? STATUS_BADGE[entry.status] : null;
    const [saving, setSaving] = useState(false);

    // 卡片只带截断的 recipePreview，保存前先拉取完整配方再入库。
    const saveToAssets = async () => {
        if (saving) return;
        setSaving(true);
        try {
            const detail = await fetchContestEntry(entry.id);
            addAsset({
                kind: "text",
                title: entry.title,
                coverUrl: "",
                tags: [entry.recipeType === "skill" ? "Skill" : "提示词"],
                source: "创作者大赛",
                data: { content: detail.recipeContent },
                metadata: { source: "contest", entryId: entry.id },
            });
            message.success("已保存到我的资产");
        } catch {
            message.error("保存失败，请稍后重试");
        } finally {
            setSaving(false);
        }
    };

    return (
        <article className="group min-w-0 overflow-hidden rounded-lg border border-stone-200 bg-white transition duration-300 hover:-translate-y-0.5 hover:border-stone-300 hover:shadow-lg dark:border-stone-800 dark:bg-stone-950 dark:hover:border-stone-700">
            <button type="button" className="relative block aspect-video w-full overflow-hidden bg-stone-950 text-left" onClick={() => onOpen(entry.id)} aria-label={`查看作品：${entry.title}`}>
                {coverUrl ? <img src={coverUrl} alt={entry.title} className="size-full object-cover transition duration-500 group-hover:scale-[1.025]" /> : <div className="size-full animate-pulse bg-stone-900" />}
                <div className="absolute inset-0 bg-gradient-to-t from-black/55 via-transparent to-black/10 opacity-80" />
                <span className="absolute left-3 top-3 inline-flex items-center gap-1 rounded-md bg-black/55 px-2 py-1 text-[11px] font-medium text-white backdrop-blur">
                    <RecipeIcon className="size-3" />
                    {entry.recipeType === "skill" ? "Skill" : "提示词"}
                </span>
                {statusBadge ? (
                    <span className={`absolute right-3 top-3 inline-flex items-center rounded-md px-2 py-1 text-[11px] font-semibold shadow-sm ${statusBadge.className}`}>{statusBadge.label}</span>
                ) : topRank ? (
                    <span className="absolute right-3 top-3 grid size-7 place-items-center rounded-md border border-white/25 bg-amber-400 text-xs font-black text-stone-950 shadow-sm">#{topRank}</span>
                ) : null}
                <span className="absolute bottom-3 left-3 grid size-9 place-items-center rounded-full bg-white/90 text-stone-950 opacity-0 shadow-md transition group-hover:opacity-100">
                    <Play className="ml-0.5 size-4 fill-current" />
                </span>
                {entry.hasWorkflow ? (
                    <span className="absolute bottom-3 right-3 inline-flex items-center gap-1 rounded-md bg-black/55 px-2 py-1 text-[11px] font-medium text-white backdrop-blur">
                        <Workflow className="size-3" />
                        制作流程
                    </span>
                ) : null}
            </button>

            <div className="px-3.5 pb-3.5 pt-3">
                <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                        <h2 className="truncate text-sm font-semibold text-stone-950 dark:text-stone-100">{entry.title}</h2>
                        <button type="button" className="mt-1 block max-w-full truncate text-left text-xs text-stone-500 transition hover:text-stone-950 dark:text-stone-400 dark:hover:text-stone-100" onClick={() => onAuthor(entry.authorId)}>
                            {entry.authorName}
                        </button>
                    </div>
                    <button
                        type="button"
                        className={`inline-flex size-8 shrink-0 items-center justify-center rounded-md border transition ${entry.favoritedByMe ? "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300" : "border-stone-200 text-stone-600 hover:border-stone-300 hover:bg-stone-50 dark:border-stone-800 dark:text-stone-300 dark:hover:border-stone-700 dark:hover:bg-stone-900"}`}
                        onClick={() => onFavorite(entry)}
                        title={entry.favoritedByMe ? "取消收藏" : "收藏作品"}
                        aria-label={entry.favoritedByMe ? "取消收藏" : "收藏作品"}
                    >
                        <Bookmark className={`size-3.5 ${entry.favoritedByMe ? "fill-current" : ""}`} />
                    </button>
                    <button
                        type="button"
                        className={`inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2 text-xs font-semibold transition ${entry.likedByMe ? "bg-rose-50 text-rose-600 dark:bg-rose-500/10 dark:text-rose-300" : entry.mine ? "cursor-not-allowed bg-stone-100 text-stone-400 dark:bg-stone-900 dark:text-stone-600" : "bg-stone-100 text-stone-600 hover:bg-rose-50 hover:text-rose-600 dark:bg-stone-900 dark:text-stone-300 dark:hover:bg-rose-500/10 dark:hover:text-rose-300"}`}
                        onClick={() => onLike(entry)}
                        disabled={entry.mine || entry.likedByMe}
                        title={entry.mine ? "不能给自己的作品点赞" : entry.likedByMe ? "已计入比赛票数" : "点赞支持作者"}
                    >
                        <Heart className={`size-3.5 ${entry.likedByMe ? "fill-current" : ""}`} />
                        <span className="tabular-nums">{entry.likes}</span>
                    </button>
                </div>

                <p className="mt-3 line-clamp-2 min-h-10 text-xs leading-5 text-stone-500 dark:text-stone-400">{entry.description || entry.recipePreview}</p>
                <div className="mt-3 flex items-center gap-2">
                    <button
                        type="button"
                        className="inline-flex h-8 flex-1 items-center justify-center gap-1.5 rounded-md border border-stone-200 text-xs font-medium text-stone-700 transition hover:border-stone-300 hover:bg-stone-50 dark:border-stone-800 dark:text-stone-200 dark:hover:border-stone-700 dark:hover:bg-stone-900"
                        onClick={() => onUse(entry)}
                    >
                        <WandSparkles className="size-3.5" />
                        {entry.recipeType === "skill" ? "使用这个 Skill" : "使用同款提示词"}
                    </button>
                    <button
                        type="button"
                        className="inline-flex size-8 shrink-0 items-center justify-center rounded-md border border-stone-200 text-stone-600 transition hover:border-stone-300 hover:bg-stone-50 disabled:opacity-50 dark:border-stone-800 dark:text-stone-300 dark:hover:border-stone-700 dark:hover:bg-stone-900"
                        onClick={() => void saveToAssets()}
                        disabled={saving}
                        title="保存到我的资产"
                    >
                        <BookmarkPlus className="size-3.5" />
                    </button>
                </div>
            </div>
        </article>
    );
}
