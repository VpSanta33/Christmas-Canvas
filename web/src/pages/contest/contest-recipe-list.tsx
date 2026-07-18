import { App, Button, Empty, Skeleton, Tag } from "antd";
import { BookmarkPlus, Copy, Sparkles, WandSparkles } from "lucide-react";

import { fetchContestEntry, type ContestEntry } from "@/services/api/contest";
import { useCopyText } from "@/hooks/use-copy-text";
import { useAssetStore } from "@/stores/use-asset-store";

type ContestRecipeListProps = {
    items: ContestEntry[];
    loading: boolean;
    onOpen: (id: string) => void;
};

// 配方分享页：把大赛作品的提示词 / Skill 单独陈列，便于直接复制或存入我的资产。
export function ContestRecipeList({ items, loading, onOpen }: ContestRecipeListProps) {
    const { message } = App.useApp();
    const copyText = useCopyText();
    const addAsset = useAssetStore((state) => state.addAsset);

    // 卡片仅带截断预览，复制 / 保存前拉取完整配方。
    const withFullRecipe = async (entry: ContestEntry) => {
        const detail = await fetchContestEntry(entry.id);
        return detail.recipeContent;
    };

    const handleCopy = async (entry: ContestEntry) => {
        try {
            copyText(await withFullRecipe(entry), "创作配方已复制");
        } catch {
            message.error("复制失败，请稍后重试");
        }
    };

    const handleSave = async (entry: ContestEntry) => {
        try {
            addAsset({
                kind: "text",
                title: entry.title,
                coverUrl: "",
                tags: [entry.recipeType === "skill" ? "Skill" : "提示词"],
                source: "创作者大赛",
                data: { content: await withFullRecipe(entry) },
                metadata: { source: "contest", entryId: entry.id },
            });
            message.success("已保存到我的资产");
        } catch {
            message.error("保存失败，请稍后重试");
        }
    };

    if (loading) {
        return (
            <div className="grid gap-4 md:grid-cols-2">
                {Array.from({ length: 6 }, (_, index) => (
                    <div key={index} className="rounded-lg border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-950">
                        <Skeleton active title paragraph={{ rows: 3 }} />
                    </div>
                ))}
            </div>
        );
    }

    if (!items.length) {
        return (
            <div className="grid min-h-80 place-items-center border-y border-stone-200 dark:border-stone-800">
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="还没有可复用的创作配方" />
            </div>
        );
    }

    return (
        <div className="grid gap-4 md:grid-cols-2">
            {items.map((entry) => {
                const RecipeIcon = entry.recipeType === "skill" ? Sparkles : WandSparkles;
                return (
                    <article key={entry.id} className="flex flex-col rounded-lg border border-stone-200 bg-white p-4 transition hover:border-stone-300 hover:shadow-sm dark:border-stone-800 dark:bg-stone-950 dark:hover:border-stone-700">
                        <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                                <button type="button" className="truncate text-left text-sm font-semibold text-stone-950 hover:underline dark:text-stone-100" onClick={() => onOpen(entry.id)}>
                                    {entry.title}
                                </button>
                                <p className="mt-1 truncate text-xs text-stone-500 dark:text-stone-400">{entry.authorName}</p>
                            </div>
                            <Tag icon={<RecipeIcon className="mr-1 inline size-3" />} color={entry.recipeType === "skill" ? "gold" : "blue"}>
                                {entry.recipeType === "skill" ? "Skill" : "提示词"}
                            </Tag>
                        </div>
                        <pre className="mt-3 max-h-40 flex-1 overflow-hidden whitespace-pre-wrap break-words rounded-md border border-stone-200 bg-stone-50 p-3 font-mono text-xs leading-5 text-stone-600 dark:border-stone-800 dark:bg-stone-900 dark:text-stone-300">{entry.recipePreview}</pre>
                        <div className="mt-3 flex items-center gap-2">
                            <Button size="small" icon={<Copy className="size-3.5" />} onClick={() => void handleCopy(entry)}>复制</Button>
                            <Button size="small" icon={<BookmarkPlus className="size-3.5" />} onClick={() => void handleSave(entry)}>存到我的资产</Button>
                        </div>
                    </article>
                );
            })}
        </div>
    );
}
