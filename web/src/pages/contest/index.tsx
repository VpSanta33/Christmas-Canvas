import { useCallback, useEffect, useState } from "react";
import { App, Button, Empty, Segmented, Skeleton } from "antd";
import { Clock3, Film, Flame, Heart, Sparkles, Trophy, Upload, Users, WandSparkles } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";

import { isBackendMode } from "@/constant/runtime-config";
import { favoriteContestEntry, fetchContestEntries, likeContestEntry, type ContestEntry, type ContestStats } from "@/services/api/contest";

import { ContestEntryCard } from "./contest-entry-card";
import { ContestEntryDetailDrawer } from "./contest-entry-detail";
import { ContestRecipeList } from "./contest-recipe-list";
import { ContestSubmitModal } from "./contest-submit-modal";

type SortMode = "popular" | "latest";
type ScopeMode = "all" | "mine";
type ViewMode = "gallery" | "recipes";

const emptyStats: ContestStats = { entries: 0, creators: 0, likes: 0 };

export default function ContestPage() {
    const { message } = App.useApp();
    const navigate = useNavigate();
    const [searchParams, setSearchParams] = useSearchParams();
    const backendMode = isBackendMode();
    const [items, setItems] = useState<ContestEntry[]>([]);
    const [stats, setStats] = useState<ContestStats>(emptyStats);
    const [sort, setSort] = useState<SortMode>("popular");
    const [scope, setScope] = useState<ScopeMode>("all");
    const [loading, setLoading] = useState(backendMode);
    const [submitOpen, setSubmitOpen] = useState(false);
    const [selectedId, setSelectedId] = useState<string | null>(() => searchParams.get("entry"));
    const [view, setView] = useState<ViewMode>("gallery");

    const loadEntries = useCallback(async () => {
        try {
            const data = await fetchContestEntries({ sort, scope, limit: 48 });
            setItems(data.items);
            setStats(data.stats);
        } catch {
            message.error("大赛作品加载失败");
        } finally {
            setLoading(false);
        }
    }, [message, scope, sort]);

    useEffect(() => {
        if (!backendMode) return;
        let alive = true;
        void fetchContestEntries({ sort, scope, limit: 48 })
            .then((data) => {
                if (!alive) return;
                setItems(data.items);
                setStats(data.stats);
            })
            .catch(() => alive && message.error("大赛作品加载失败"))
            .finally(() => alive && setLoading(false));
        return () => {
            alive = false;
        };
    }, [backendMode, message, scope, sort]);

    const handleLike = async (entry: ContestEntry) => {
        if (entry.mine || entry.likedByMe) return;
        try {
            const result = await likeContestEntry(entry.id);
            setItems((current) => current.map((item) => (item.id === entry.id ? { ...item, likedByMe: true, likes: result.likes } : item)));
            setStats((current) => ({ ...current, likes: current.likes + 1 }));
            message.success("点赞成功");
            return result.likes;
        } catch (error) {
            message.error(error instanceof Error ? error.message : "点赞失败");
            throw error;
        }
    };

    const handleFavorite = async (entry: ContestEntry) => {
        const next = !entry.favoritedByMe;
        try {
            const favorited = await favoriteContestEntry(entry.id, next);
            setItems((current) => current.map((item) => (item.id === entry.id ? { ...item, favoritedByMe: favorited } : item)));
            message.success(favorited ? "已收藏作品" : "已取消收藏");
            return favorited;
        } catch (error) {
            message.error(error instanceof Error ? error.message : "收藏操作失败");
            throw error;
        }
    };

    const useEntry = (entry: ContestEntry) => {
        navigate(`/video?contest=${encodeURIComponent(entry.id)}`);
    };

    const handleSubmitSuccess = () => {
        setView("gallery");
        setLoading(true);
        if (scope === "mine" && sort === "latest") {
            void loadEntries();
            return;
        }
        setScope("mine");
        setSort("latest");
    };

    const closeEntry = () => {
        setSelectedId(null);
        if (!searchParams.has("entry")) return;
        const next = new URLSearchParams(searchParams);
        next.delete("entry");
        setSearchParams(next, { replace: true });
    };

    if (!backendMode) {
        return (
            <main className="grid h-full place-items-center bg-background px-6">
                <Empty description="创作者大赛需要连接后端账号与作品存储" />
            </main>
        );
    }

    return (
        <main className="h-full overflow-y-auto bg-[#fafaf9] text-stone-950 dark:bg-[#0c0a09] dark:text-stone-100">
            <section className="border-b border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-950">
                <div className="mx-auto grid max-w-7xl gap-7 px-6 py-8 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
                    <div>
                        <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase text-amber-600 dark:text-amber-400">
                            <Trophy className="size-4" />
                            Creator Challenge
                        </div>
                        <h1 className="text-3xl font-semibold tracking-normal sm:text-4xl">创作者大赛</h1>
                        <p className="mt-3 max-w-2xl text-sm leading-6 text-stone-500 dark:text-stone-400">发布你的 AI 视频与完整创作配方。分享提示词或 Skill，让好作品不仅被看见，也能被下一位创作者直接使用。</p>
                    </div>
                    <div className="grid grid-cols-3 gap-6 border-l-0 border-stone-200 lg:border-l lg:pl-8 dark:border-stone-800">
                        <Stat icon={Sparkles} value={stats.entries} label="参赛作品" />
                        <Stat icon={Users} value={stats.creators} label="创作者" />
                        <Stat icon={Heart} value={stats.likes} label="累计点赞" />
                    </div>
                </div>
            </section>

            <div className="mx-auto max-w-7xl px-6 py-6">
                <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
                    <div className="flex flex-wrap items-center gap-2">
                        <Segmented
                            value={view}
                            onChange={(value) => setView(value as ViewMode)}
                            options={[
                                {
                                    value: "gallery",
                                    label: (
                                        <span className="inline-flex items-center gap-1.5">
                                            <Film className="size-3.5" />
                                            作品广场
                                        </span>
                                    ),
                                },
                                {
                                    value: "recipes",
                                    label: (
                                        <span className="inline-flex items-center gap-1.5">
                                            <WandSparkles className="size-3.5" />
                                            配方分享
                                        </span>
                                    ),
                                },
                            ]}
                        />
                        <Segmented
                            value={sort}
                            onChange={(value) => {
                                setLoading(true);
                                setSort(value as SortMode);
                            }}
                            options={[
                                {
                                    value: "popular",
                                    label: (
                                        <span className="inline-flex items-center gap-1.5">
                                            <Flame className="size-3.5" />
                                            热门
                                        </span>
                                    ),
                                },
                                {
                                    value: "latest",
                                    label: (
                                        <span className="inline-flex items-center gap-1.5">
                                            <Clock3 className="size-3.5" />
                                            最新
                                        </span>
                                    ),
                                },
                            ]}
                        />
                        <Segmented
                            value={scope}
                            onChange={(value) => {
                                setLoading(true);
                                setScope(value as ScopeMode);
                            }}
                            options={[
                                { value: "all", label: "全部作品" },
                                { value: "mine", label: "我的投稿" },
                            ]}
                        />
                    </div>
                    <Button type="primary" icon={<Upload className="size-4" />} onClick={() => setSubmitOpen(true)}>
                        发布作品
                    </Button>
                </div>

                {view === "recipes" ? (
                    <ContestRecipeList items={items} loading={loading} onOpen={setSelectedId} />
                ) : (
                    <>
                        {loading ? (
                            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                                {Array.from({ length: 8 }, (_, index) => (
                                    <div key={index} className="overflow-hidden rounded-lg border border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-950">
                                        <Skeleton.Image active className="!h-auto !w-full !rounded-none !aspect-video" />
                                        <div className="p-4">
                                            <Skeleton active title paragraph={{ rows: 2 }} />
                                        </div>
                                    </div>
                                ))}
                            </div>
                        ) : items.length ? (
                            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                                {items.map((entry, index) => (
                                    <ContestEntryCard
                                        key={entry.id}
                                        entry={entry}
                                        rank={sort === "popular" && scope === "all" ? index + 1 : undefined}
                                        onOpen={setSelectedId}
                                        onLike={(item) => void handleLike(item)}
                                        onFavorite={(item) => void handleFavorite(item)}
                                        onUse={useEntry}
                                        onAuthor={(authorId) => navigate(`/creators/${encodeURIComponent(authorId)}`)}
                                    />
                                ))}
                            </div>
                        ) : (
                            <div className="grid min-h-80 place-items-center border-y border-stone-200 dark:border-stone-800">
                                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={scope === "mine" ? "你还没有发布参赛作品" : "还没有参赛作品"}>
                                    <Button type="primary" icon={<WandSparkles className="size-4" />} onClick={() => setSubmitOpen(true)}>
                                        发布第一件作品
                                    </Button>
                                </Empty>
                            </div>
                        )}
                    </>
                )}
            </div>

            <ContestSubmitModal open={submitOpen} onClose={() => setSubmitOpen(false)} onSuccess={handleSubmitSuccess} />
            <ContestEntryDetailDrawer entryId={selectedId} onClose={closeEntry} onLike={handleLike} onFavorite={handleFavorite} onUse={useEntry} />
        </main>
    );
}

function Stat({ icon: Icon, value, label }: { icon: typeof Heart; value: number; label: string }) {
    return (
        <div className="min-w-20">
            <div className="flex items-center gap-1.5 text-xl font-semibold tabular-nums">
                <Icon className="size-4 text-stone-400" />
                {value}
            </div>
            <div className="mt-1 text-xs text-stone-500 dark:text-stone-400">{label}</div>
        </div>
    );
}
