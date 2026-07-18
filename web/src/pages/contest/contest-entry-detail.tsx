import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { App, Button, Drawer, Skeleton, Tag } from "antd";
import { Bookmark, BookmarkPlus, Boxes, Copy, Heart, Images, SlidersHorizontal, Sparkles, WandSparkles, Workflow } from "lucide-react";

import { fetchContestEntry, type ContestEntryDetail } from "@/services/api/contest";
import { useCopyText } from "@/hooks/use-copy-text";
import { useAssetStore } from "@/stores/use-asset-store";

import { useContestObjectUrl } from "./contest-media";
import { ContestWorkflowViewer } from "./contest-workflow-viewer";
import { cloneContestProject } from "./contest-clone";
import { summarizeContestWorkflow } from "./contest-workflow-summary";

type ContestEntryDetailProps = {
    entryId: string | null;
    onClose: () => void;
    onLike: (entry: ContestEntryDetail) => Promise<number | void>;
    onFavorite: (entry: ContestEntryDetail) => Promise<boolean | void>;
    onUse: (entry: ContestEntryDetail) => void;
};

export function ContestEntryDetailDrawer({ entryId, onClose, onLike, onFavorite, onUse }: ContestEntryDetailProps) {
    const { message } = App.useApp();
    const navigate = useNavigate();
    const copyText = useCopyText();
    const addAsset = useAssetStore((state) => state.addAsset);
    const [entry, setEntry] = useState<ContestEntryDetail | null>(null);
    const [viewerOpen, setViewerOpen] = useState(false);
    const [copying, setCopying] = useState(false);
    const [saved, setSaved] = useState(false);
    const videoUrl = useContestObjectUrl(entryId, "video");
    const loading = Boolean(entryId && entry?.id !== entryId);
    const workflowSummary = entry?.canvasSnapshot ? summarizeContestWorkflow(entry.canvasSnapshot) : null;

    const closeDetail = () => {
        setViewerOpen(false);
        onClose();
    };

    // 复制项目：媒体落地 + 建新画布可能耗时/失败，需要 loading 与错误反馈，
    // 并用 copying 防重复点击（避免克隆两份）。仅在成功后才跳转。
    const copyProject = async () => {
        if (!entry?.canvasSnapshot || copying) return;
        setCopying(true);
        try {
            const projectId = await cloneContestProject(entry.id, entry.canvasSnapshot, entry.title);
            message.success("已复制到我的画布");
            navigate(`/canvas/${projectId}`);
        } catch {
            message.error("复制项目失败，请重试");
        } finally {
            setCopying(false);
        }
    };

    const saveToAssets = () => {
        if (!entry || saved) return; // saved 防重复点击，避免同一配方存两份
        addAsset({
            kind: "text",
            title: entry.title,
            coverUrl: "",
            tags: [entry.recipeType === "skill" ? "Skill" : "提示词"],
            source: "创作者大赛",
            data: { content: entry.recipeContent },
            metadata: { source: "contest", entryId: entry.id },
        });
        setSaved(true);
        message.success("已保存到我的资产");
    };

    const handleLike = async () => {
        if (!entry || entry.mine || entry.likedByMe) return;
        const likes = await onLike(entry);
        setEntry((current) => (current ? { ...current, likedByMe: true, likes: typeof likes === "number" ? likes : current.likes + 1 } : current));
    };

    const handleFavorite = async () => {
        if (!entry) return;
        const favorited = await onFavorite(entry);
        setEntry((current) => (current ? { ...current, favoritedByMe: typeof favorited === "boolean" ? favorited : !current.favoritedByMe } : current));
    };

    useEffect(() => {
        if (!entryId) return;
        let alive = true;
        setSaved(false); // 切换作品时重置「已保存」状态
        void fetchContestEntry(entryId)
            .then((next) => alive && setEntry(next))
            .catch(() => alive && message.error("作品加载失败"));
        return () => {
            alive = false;
        };
    }, [entryId, message]);

    return (
        <>
            <Drawer open={Boolean(entryId)} onClose={closeDetail} width={720} title={entry?.title || "作品详情"} destroyOnHidden>
                {loading || !entry ? (
                    <Skeleton active paragraph={{ rows: 8 }} />
                ) : (
                    <div className="space-y-6 pb-6">
                        <div className="aspect-video overflow-hidden rounded-lg bg-black">
                            {videoUrl ? <video src={videoUrl} controls autoPlay playsInline className="size-full object-contain" /> : <div className="size-full animate-pulse bg-stone-900" />}
                        </div>

                        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-stone-200 pb-5 dark:border-stone-800">
                            <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                    <Tag color={entry.recipeType === "skill" ? "gold" : "blue"}>{entry.recipeType === "skill" ? "视频 Skill" : "视频提示词"}</Tag>
                                    <button type="button" className="text-xs text-stone-500 transition hover:text-stone-950 dark:hover:text-stone-100" onClick={() => navigate(`/creators/${encodeURIComponent(entry.authorId)}`)}>
                                        {entry.authorName}
                                    </button>
                                </div>
                                {entry.description ? <p className="mt-3 max-w-2xl text-sm leading-6 text-stone-600 dark:text-stone-300">{entry.description}</p> : null}
                            </div>
                            <div className="flex items-center gap-2">
                                <Button icon={<Bookmark className={entry.favoritedByMe ? "fill-current" : ""} />} onClick={() => void handleFavorite()}>
                                    {entry.favoritedByMe ? "已收藏" : "收藏"}
                                </Button>
                                <Button icon={<Heart className={entry.likedByMe ? "fill-current" : ""} />} disabled={entry.mine || entry.likedByMe} onClick={() => void handleLike()}>
                                    {entry.likedByMe ? "已点赞" : entry.mine ? "我的作品" : "点赞"} · {entry.likes}
                                </Button>
                            </div>
                        </div>

                        {workflowSummary ? (
                            <section className="border-b border-stone-200 pb-5 dark:border-stone-800">
                                <div className="mb-3 flex items-center gap-2">
                                    <SlidersHorizontal className="size-4 text-stone-400" />
                                    <h3 className="text-sm font-semibold">制作信息</h3>
                                </div>
                                <div className="grid gap-3 text-xs sm:grid-cols-3">
                                    <div className="flex items-center gap-2">
                                        <Boxes className="size-4 text-stone-400" />
                                        <span>
                                            {workflowSummary.nodes} 个节点 · {workflowSummary.connections} 条连线
                                        </span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <Images className="size-4 text-stone-400" />
                                        <span>
                                            {workflowSummary.images} 图 · {workflowSummary.videos} 视频 · {workflowSummary.audios} 音频
                                        </span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <Workflow className="size-4 text-stone-400" />
                                        <span>{workflowSummary.references} 个素材引用</span>
                                    </div>
                                </div>
                                {workflowSummary.models.length || workflowSummary.parameters.length ? (
                                    <div className="mt-3 flex flex-wrap gap-1.5">
                                        {workflowSummary.models.map((model) => (
                                            <Tag key={model}>{model}</Tag>
                                        ))}
                                        {workflowSummary.parameters.map((parameter) => (
                                            <Tag key={parameter} color="default">
                                                {parameter}
                                            </Tag>
                                        ))}
                                    </div>
                                ) : null}
                            </section>
                        ) : null}

                        <section>
                            <div className="mb-3 flex items-center justify-between gap-3">
                                <div className="flex items-center gap-2">
                                    {entry.recipeType === "skill" ? <Sparkles className="size-4 text-amber-500" /> : <WandSparkles className="size-4 text-sky-500" />}
                                    <h3 className="text-sm font-semibold">{entry.recipeType === "skill" ? "创作 Skill" : "完整提示词"}</h3>
                                </div>
                                <div className="flex items-center gap-1">
                                    <Button type="text" size="small" icon={<BookmarkPlus className="size-3.5" />} onClick={saveToAssets} disabled={saved}>
                                        {saved ? "已存入资产" : "存到我的资产"}
                                    </Button>
                                    <Button type="text" size="small" icon={<Copy className="size-3.5" />} onClick={() => copyText(entry.recipeContent, "创作配方已复制")}>
                                        复制
                                    </Button>
                                </div>
                            </div>
                            <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-stone-200 bg-stone-50 p-4 font-mono text-xs leading-6 text-stone-700 dark:border-stone-800 dark:bg-stone-950 dark:text-stone-200">
                                {entry.recipeContent}
                            </pre>
                        </section>

                        <div className={`grid gap-2 ${entry.canvasSnapshot ? "sm:grid-cols-2" : ""}`}>
                            {entry.canvasSnapshot ? (
                                <Button size="large" icon={<Workflow className="size-4" />} onClick={() => setViewerOpen(true)}>
                                    查看制作流程
                                </Button>
                            ) : null}
                            <Button type="primary" size="large" icon={<WandSparkles className="size-4" />} onClick={() => onUse(entry)}>
                                {entry.recipeType === "skill" ? "使用这个 Skill 创作" : "使用同款提示词创作"}
                            </Button>
                        </div>
                    </div>
                )}
            </Drawer>
            {viewerOpen && entry?.canvasSnapshot ? <ContestWorkflowViewer entryId={entry.id} title={entry.title} snapshot={entry.canvasSnapshot} onClose={() => setViewerOpen(false)} onCopyProject={copyProject} /> : null}
        </>
    );
}
