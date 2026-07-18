import { useEffect, useState } from "react";
import { App, Button, Empty, Segmented, Skeleton } from "antd";
import { Bookmark, Compass, Heart, UsersRound, UserRoundCheck, WandSparkles } from "lucide-react";
import { useNavigate } from "react-router-dom";

import { isBackendMode } from "@/constant/runtime-config";
import { favoriteContestEntry, likeContestEntry, type ContestEntry } from "@/services/api/contest";
import { fetchCreatorFeed, type CreatorFeedScope } from "@/services/api/creators";

import { ContestEntryCard } from "../contest/contest-entry-card";
import { ContestEntryDetailDrawer } from "../contest/contest-entry-detail";

const scopeOptions = [
    { value: "discover", label: <span className="inline-flex items-center gap-1.5"><Compass className="size-3.5" />发现</span> },
    { value: "following", label: <span className="inline-flex items-center gap-1.5"><UserRoundCheck className="size-3.5" />关注动态</span> },
    { value: "favorites", label: <span className="inline-flex items-center gap-1.5"><Bookmark className="size-3.5" />我的收藏</span> },
] as const;

export default function CreatorsPage() {
    const { message } = App.useApp();
    const navigate = useNavigate();
    const backendMode = isBackendMode();
    const [scope, setScope] = useState<CreatorFeedScope>("discover");
    const [items, setItems] = useState<ContestEntry[]>([]);
    const [loading, setLoading] = useState(backendMode);
    const [loadedScope, setLoadedScope] = useState<CreatorFeedScope | null>(null);
    const [selectedId, setSelectedId] = useState<string | null>(null);

    useEffect(() => {
        if (!backendMode) return;
        let alive = true;
        void fetchCreatorFeed(scope)
            .then((next) => {
                if (!alive) return;
                setItems(next);
                setLoadedScope(scope);
            })
            .catch(() => {
                if (!alive) return;
                setLoadedScope(scope);
                message.error("创作者内容加载失败");
            })
            .finally(() => alive && setLoading(false));
        return () => {
            alive = false;
        };
    }, [backendMode, message, scope]);

    const handleLike = async (entry: ContestEntry) => {
        if (entry.mine || entry.likedByMe) return;
        const result = await likeContestEntry(entry.id);
        setItems((current) => current.map((item) => (item.id === entry.id ? { ...item, likedByMe: true, likes: result.likes } : item)));
        message.success("点赞成功");
        return result.likes;
    };

    const handleFavorite = async (entry: ContestEntry) => {
        const favorited = await favoriteContestEntry(entry.id, !entry.favoritedByMe);
        setItems((current) => {
            if (scope === "favorites" && !favorited) return current.filter((item) => item.id !== entry.id);
            return current.map((item) => (item.id === entry.id ? { ...item, favoritedByMe: favorited } : item));
        });
        message.success(favorited ? "已收藏作品" : "已取消收藏");
        return favorited;
    };

    const closeDetail = () => setSelectedId(null);
    const isLoading = loading || loadedScope !== scope;

    if (!backendMode) {
        return <main className="grid h-full place-items-center bg-background px-6"><Empty description="创作者中心需要连接后端社区" /></main>;
    }

    return (
        <main className="h-full overflow-y-auto bg-[#f7f7f5] text-stone-950 dark:bg-[#0d0d0c] dark:text-stone-100">
            <header className="border-b border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-950">
                <div className="mx-auto max-w-7xl px-6 py-8">
                    <div className="flex flex-wrap items-end justify-between gap-6">
                        <div>
                            <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-sky-600 dark:text-sky-400"><UsersRound className="size-3.5" />CREATOR NETWORK</div>
                            <h1 className="text-3xl font-semibold tracking-normal sm:text-4xl">创作者</h1>
                            <p className="mt-2 max-w-xl text-sm leading-6 text-stone-500 dark:text-stone-400">发现值得复用的工作流，关注持续更新的创作者，把喜欢的作品留在自己的创作队列里。</p>
                        </div>
                        <Button icon={<WandSparkles className="size-4" />} onClick={() => navigate("/contest")}>浏览创作者大赛</Button>
                    </div>
                </div>
            </header>

            <div className="mx-auto max-w-7xl px-6 py-6">
                <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
                    <Segmented value={scope} onChange={(value) => setScope(value as CreatorFeedScope)} options={scopeOptions.map((option) => ({ value: option.value, label: option.label }))} />
                    <div className="inline-flex items-center gap-1.5 text-xs text-stone-400"><Heart className="size-3.5" />关注和收藏会同步到你的账号</div>
                </div>

                {isLoading ? (
                    <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                        {Array.from({ length: 8 }, (_, index) => <div key={index} className="overflow-hidden rounded-lg border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-950"><Skeleton active paragraph={{ rows: 4 }} /></div>)}
                    </div>
                ) : items.length ? (
                    <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                        {items.map((entry) => (
                            <ContestEntryCard
                                key={entry.id}
                                entry={entry}
                                onOpen={setSelectedId}
                                onLike={(item) => void handleLike(item)}
                                onFavorite={(item) => void handleFavorite(item)}
                                onUse={(item) => navigate(`/video?contest=${encodeURIComponent(item.id)}`)}
                                onAuthor={(authorId) => navigate(`/creators/${encodeURIComponent(authorId)}`)}
                            />
                        ))}
                    </div>
                ) : (
                    <div className="grid min-h-96 place-items-center border-y border-stone-200 dark:border-stone-800">
                        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={scope === "following" ? "关注创作者后，这里会出现最新作品" : scope === "favorites" ? "收藏作品后，这里会形成你的灵感清单" : "还没有公开作品"}>
                            <Button type="primary" icon={<Compass className="size-4" />} onClick={() => navigate("/contest")}>去发现作品</Button>
                        </Empty>
                    </div>
                )}
            </div>

            <ContestEntryDetailDrawer
                entryId={selectedId}
                onClose={closeDetail}
                onLike={handleLike}
                onFavorite={handleFavorite}
                onUse={(entry) => navigate(`/video?contest=${encodeURIComponent(entry.id)}`)}
            />
        </main>
    );
}
