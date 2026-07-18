import { useEffect, useState } from "react";
import { App, Avatar, Button, Empty, Skeleton, Tag } from "antd";
import { ArrowLeft, Check, Heart, UserPlus, UsersRound } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";

import { isBackendMode } from "@/constant/runtime-config";
import { favoriteContestEntry, likeContestEntry, type ContestEntry } from "@/services/api/contest";
import { fetchCreator, followCreator, type CreatorProfile } from "@/services/api/creators";

import { ContestEntryCard } from "../contest/contest-entry-card";
import { ContestEntryDetailDrawer } from "../contest/contest-entry-detail";

export default function CreatorProfilePage() {
    const { message } = App.useApp();
    const navigate = useNavigate();
    const { id } = useParams();
    const backendMode = isBackendMode();
    const [creator, setCreator] = useState<CreatorProfile | null>(null);
    const [items, setItems] = useState<ContestEntry[]>([]);
    const [loading, setLoading] = useState(backendMode);
    const [loadedId, setLoadedId] = useState<string | null>(null);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [following, setFollowing] = useState(false);

    useEffect(() => {
        if (!backendMode || !id) return;
        let alive = true;
        void fetchCreator(id)
            .then((data) => {
                if (!alive) return;
                setCreator(data.creator);
                setItems(data.items);
                setFollowing(data.creator.followedByMe);
                setLoadedId(id);
            })
            .catch(() => {
                if (!alive) return;
                setLoadedId(id);
                message.error("创作者主页加载失败");
            })
            .finally(() => alive && setLoading(false));
        return () => {
            alive = false;
        };
    }, [backendMode, id, message]);

    const toggleFollow = async () => {
        if (!creator || creator.mine) return;
        const result = await followCreator(creator.id, !following);
        setFollowing(result.following);
        setCreator((current) => (current ? { ...current, followedByMe: result.following, followers: result.followers } : current));
        message.success(result.following ? `已关注 ${creator.displayName}` : "已取消关注");
    };

    const handleLike = async (entry: ContestEntry) => {
        if (entry.mine || entry.likedByMe) return;
        const result = await likeContestEntry(entry.id);
        setItems((current) => current.map((item) => (item.id === entry.id ? { ...item, likedByMe: true, likes: result.likes } : item)));
        setCreator((current) => (current ? { ...current, likes: current.likes + 1 } : current));
        message.success("点赞成功");
        return result.likes;
    };

    const handleFavorite = async (entry: ContestEntry) => {
        const favorited = await favoriteContestEntry(entry.id, !entry.favoritedByMe);
        setItems((current) => current.map((item) => (item.id === entry.id ? { ...item, favoritedByMe: favorited } : item)));
        message.success(favorited ? "已收藏作品" : "已取消收藏");
        return favorited;
    };

    if (!backendMode) return <main className="grid h-full place-items-center bg-background px-6"><Empty description="创作者主页需要连接后端社区" /></main>;
    const isLoading = loading || loadedId !== id;

    return (
        <main className="h-full overflow-y-auto bg-[#f7f7f5] text-stone-950 dark:bg-[#0d0d0c] dark:text-stone-100">
            <header className="border-b border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-950">
                <div className="mx-auto max-w-7xl px-6 py-6">
                    <Button type="text" icon={<ArrowLeft className="size-4" />} onClick={() => navigate("/creators")}>返回创作者</Button>
                    {isLoading ? <div className="mt-8"><Skeleton active avatar paragraph={{ rows: 2 }} /></div> : creator ? (
                        <div className="mt-7 flex flex-wrap items-start justify-between gap-6">
                            <div className="flex min-w-0 items-start gap-4">
                                <Avatar size={72} src={creator.avatarUrl || undefined} className="shrink-0 bg-stone-900 text-xl dark:bg-stone-100 dark:text-stone-950">{creator.displayName.slice(0, 1).toUpperCase()}</Avatar>
                                <div className="min-w-0">
                                    <div className="flex flex-wrap items-center gap-2"><h1 className="truncate text-3xl font-semibold">{creator.displayName}</h1>{creator.mine ? <Tag color="blue">我的主页</Tag> : null}</div>
                                    <p className="mt-2 text-sm text-stone-500 dark:text-stone-400">加入于 {formatDate(creator.joinedAt)} · 持续发布可复用的创作流程</p>
                                    <div className="mt-4 flex flex-wrap items-center gap-5 text-sm"><Stat icon={UsersRound} value={creator.followers} label="关注者" /><Stat icon={UserPlus} value={creator.following} label="关注中" /><Stat icon={Check} value={creator.works} label="已发布" /><Stat icon={Heart} value={creator.likes} label="获赞" /></div>
                                </div>
                            </div>
                            {!creator.mine ? <Button type={following ? "default" : "primary"} icon={following ? <Check className="size-4" /> : <UserPlus className="size-4" />} onClick={() => void toggleFollow()}>{following ? "已关注" : "关注创作者"}</Button> : null}
                        </div>
                    ) : null}
                </div>
            </header>

                <div className="mx-auto max-w-7xl px-6 py-7">
                <div className="mb-5 flex items-center justify-between gap-3"><div><h2 className="text-lg font-semibold">公开作品</h2><p className="mt-1 text-sm text-stone-500 dark:text-stone-400">经过审核并可被其他创作者复用的作品。</p></div><span className="text-xs text-stone-400">{items.length} 件</span></div>
                {isLoading ? <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">{Array.from({ length: 4 }, (_, index) => <div key={index} className="rounded-lg border border-stone-200 bg-white p-4 dark:border-stone-950"><Skeleton active paragraph={{ rows: 4 }} /></div>)}</div> : items.length ? (
                    <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">{items.map((entry) => <ContestEntryCard key={entry.id} entry={entry} onOpen={setSelectedId} onLike={(item) => void handleLike(item)} onFavorite={(item) => void handleFavorite(item)} onUse={(item) => navigate(`/video?contest=${encodeURIComponent(item.id)}`)} onAuthor={(authorId) => navigate(`/creators/${encodeURIComponent(authorId)}`)} />)}</div>
                ) : <div className="grid min-h-72 place-items-center border-y border-stone-200 dark:border-stone-800"><Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="还没有公开作品" /></div>}
            </div>

            <ContestEntryDetailDrawer entryId={selectedId} onClose={() => setSelectedId(null)} onLike={handleLike} onFavorite={handleFavorite} onUse={(entry) => navigate(`/video?contest=${encodeURIComponent(entry.id)}`)} />
        </main>
    );
}

function Stat({ icon: Icon, value, label }: { icon: typeof Heart; value: number; label: string }) {
    return <span className="inline-flex items-center gap-1.5 text-stone-600 dark:text-stone-300"><Icon className="size-3.5 text-stone-400" /><strong className="tabular-nums">{value}</strong><span className="text-xs text-stone-400">{label}</span></span>;
}

function formatDate(value: string) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "最近" : date.toLocaleDateString("zh-CN", { year: "numeric", month: "short" });
}
