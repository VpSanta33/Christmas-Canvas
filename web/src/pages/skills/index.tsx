import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { App, Button, Empty, Input, Skeleton, Tag } from "antd";
import { Eye, Heart, Search, Sparkles, Workflow } from "lucide-react";
import { useNavigate } from "react-router-dom";

import { isBackendMode } from "@/constant/runtime-config";
import { fetchContestEntries, fetchContestEntry, type ContestEntry } from "@/services/api/contest";
import { useWorkbenchAgentStore } from "@/stores/use-workbench-agent-store";
import { useContestObjectUrl } from "@/pages/contest/contest-media";

export default function SkillsPage() {
    const { message } = App.useApp();
    const navigate = useNavigate();
    const dispatchVideo = useWorkbenchAgentStore((state) => state.dispatchVideo);
    const [items, setItems] = useState<ContestEntry[]>([]);
    const [loading, setLoading] = useState(isBackendMode());
    const [keyword, setKeyword] = useState("");
    const [runningId, setRunningId] = useState("");
    const deferredKeyword = useDeferredValue(keyword.trim().toLowerCase());

    useEffect(() => {
        if (!isBackendMode()) return;
        let alive = true;
        void fetchContestEntries({ sort: "popular", scope: "all", limit: 100 })
            .then((data) => alive && setItems(data.items.filter((entry) => entry.recipeType === "skill")))
            .catch(() => alive && message.error("Skill 加载失败"))
            .finally(() => alive && setLoading(false));
        return () => {
            alive = false;
        };
    }, [message]);

    const filtered = useMemo(() => {
        if (!deferredKeyword) return items;
        return items.filter((entry) => `${entry.title} ${entry.description} ${entry.recipePreview} ${entry.authorName}`.toLowerCase().includes(deferredKeyword));
    }, [deferredKeyword, items]);

    const runSkill = async (entry: ContestEntry) => {
        setRunningId(entry.id);
        try {
            const detail = await fetchContestEntry(entry.id);
            dispatchVideo({ prompt: `请按照以下视频创作 Skill 执行：\n\n${detail.recipeContent}`, run: false });
            navigate("/video");
        } catch {
            message.error("Skill 加载失败");
        } finally {
            setRunningId("");
        }
    };

    if (!isBackendMode()) {
        return (
            <main className="grid h-full place-items-center bg-background px-6">
                <Empty description="Skill 中心需要连接后端社区" />
            </main>
        );
    }

    return (
        <main className="h-full overflow-y-auto bg-[#f7f7f5] text-stone-950 dark:bg-[#0d0d0c] dark:text-stone-100">
            <header className="border-b border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-950">
                <div className="mx-auto max-w-7xl px-6 py-8">
                    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_420px] lg:items-end">
                        <div>
                            <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-amber-600 dark:text-amber-400">
                                <Sparkles className="size-3.5" />
                                SKILL LIBRARY
                            </div>
                            <h1 className="text-3xl font-semibold">Skill 中心</h1>
                            <p className="mt-2 text-sm text-stone-500 dark:text-stone-400">选择经过作品验证的创作方法，带入视频工作台继续调整。</p>
                        </div>
                        <Input size="large" allowClear value={keyword} prefix={<Search className="size-4 text-stone-400" />} placeholder="搜索标题、作者或适用场景" onChange={(event) => setKeyword(event.target.value)} />
                    </div>
                </div>
            </header>

            <div className="mx-auto max-w-7xl px-6 py-7">
                {loading ? (
                    <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                        {Array.from({ length: 8 }, (_, index) => (
                            <div key={index} className="overflow-hidden rounded-lg border border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-950">
                                <Skeleton.Image active className="!aspect-video !h-auto !w-full !rounded-none" />
                                <div className="p-4">
                                    <Skeleton active paragraph={{ rows: 2 }} />
                                </div>
                            </div>
                        ))}
                    </div>
                ) : filtered.length ? (
                    <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                        {filtered.map((entry) => (
                            <SkillCard key={entry.id} entry={entry} running={runningId === entry.id} onRun={() => void runSkill(entry)} onOpen={() => navigate(`/contest?entry=${encodeURIComponent(entry.id)}`)} />
                        ))}
                    </div>
                ) : (
                    <div className="grid min-h-80 place-items-center border-y border-stone-200 dark:border-stone-800">
                        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={keyword ? "没有匹配的 Skill" : "还没有已发布的 Skill"} />
                    </div>
                )}
            </div>
        </main>
    );
}

function SkillCard({ entry, running, onRun, onOpen }: { entry: ContestEntry; running: boolean; onRun: () => void; onOpen: () => void }) {
    const coverUrl = useContestObjectUrl(entry.id, "cover");
    return (
        <article className="group min-w-0 overflow-hidden rounded-lg border border-stone-200 bg-white transition hover:-translate-y-0.5 hover:border-stone-300 hover:shadow-lg dark:border-stone-800 dark:bg-stone-950 dark:hover:border-stone-700">
            <button type="button" className="relative block aspect-video w-full overflow-hidden bg-stone-900 text-left" onClick={onOpen} aria-label={`查看 ${entry.title}`}>
                {coverUrl ? <img src={coverUrl} alt={entry.title} className="size-full object-cover transition duration-500 group-hover:scale-[1.025]" /> : <div className="size-full animate-pulse bg-stone-900" />}
                <div className="absolute inset-0 bg-gradient-to-t from-black/65 via-transparent to-black/10" />
                <Tag color="gold" className="absolute left-3 top-3 m-0">
                    <Sparkles className="mr-1 inline size-3" />
                    Skill
                </Tag>
                {entry.hasWorkflow ? (
                    <span className="absolute bottom-3 right-3 inline-flex items-center gap-1 rounded-md bg-black/55 px-2 py-1 text-[11px] text-white backdrop-blur">
                        <Workflow className="size-3" />
                        工作流
                    </span>
                ) : null}
            </button>
            <div className="p-4">
                <h2 className="truncate text-sm font-semibold">{entry.title}</h2>
                <div className="mt-1 flex items-center justify-between gap-3 text-xs text-stone-500 dark:text-stone-400">
                    <span className="truncate">{entry.authorName}</span>
                    <span className="inline-flex shrink-0 items-center gap-1 tabular-nums">
                        <Heart className="size-3" />
                        {entry.likes}
                    </span>
                </div>
                <p className="mt-3 line-clamp-3 min-h-[60px] text-xs leading-5 text-stone-500 dark:text-stone-400">{entry.description || entry.recipePreview}</p>
                <div className="mt-4 grid grid-cols-[minmax(0,1fr)_auto] gap-2">
                    <Button type="primary" loading={running} icon={<Sparkles className="size-3.5" />} onClick={onRun}>
                        使用 Skill
                    </Button>
                    <Button icon={<Eye className="size-3.5" />} onClick={onOpen} aria-label="查看详情" />
                </div>
            </div>
        </article>
    );
}
