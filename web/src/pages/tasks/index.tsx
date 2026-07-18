import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { Button, Empty, Input, Segmented, Spin, Tag } from "antd";
import { CheckCircle2, Clock3, ImagePlus, LoaderCircle, RefreshCw, Search, Video, XCircle } from "lucide-react";
import { useNavigate } from "react-router-dom";

import { formatDuration } from "@/lib/image-utils";
import { GENERATION_HISTORY_CHANGED, readGenerationTasks, type GenerationTaskItem, type GenerationTaskStatus } from "@/services/generation-history";

type StatusFilter = "all" | GenerationTaskStatus;
type CapabilityFilter = "all" | GenerationTaskItem["capability"];

const statusMeta: Record<GenerationTaskStatus, { label: string; color: string; icon: typeof Clock3 }> = {
    running: { label: "进行中", color: "processing", icon: LoaderCircle },
    completed: { label: "已完成", color: "success", icon: CheckCircle2 },
    failed: { label: "失败", color: "error", icon: XCircle },
};

export default function TasksPage() {
    const navigate = useNavigate();
    const [items, setItems] = useState<GenerationTaskItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [status, setStatus] = useState<StatusFilter>("all");
    const [capability, setCapability] = useState<CapabilityFilter>("all");
    const [keyword, setKeyword] = useState("");
    const deferredKeyword = useDeferredValue(keyword.trim().toLowerCase());

    const refresh = async () => {
        setItems(await readGenerationTasks());
        setLoading(false);
    };

    useEffect(() => {
        let alive = true;
        void readGenerationTasks().then((tasks) => {
            if (!alive) return;
            setItems(tasks);
            setLoading(false);
        });
        const onChanged = () => void refresh();
        const onVisibility = () => {
            if (document.visibilityState === "visible") void refresh();
        };
        window.addEventListener(GENERATION_HISTORY_CHANGED, onChanged);
        document.addEventListener("visibilitychange", onVisibility);
        return () => {
            alive = false;
            window.removeEventListener(GENERATION_HISTORY_CHANGED, onChanged);
            document.removeEventListener("visibilitychange", onVisibility);
        };
    }, []);

    const filtered = useMemo(
        () =>
            items.filter((item) => {
                if (status !== "all" && item.status !== status) return false;
                if (capability !== "all" && item.capability !== capability) return false;
                if (!deferredKeyword) return true;
                return `${item.title} ${item.prompt} ${item.model}`.toLowerCase().includes(deferredKeyword);
            }),
        [capability, deferredKeyword, items, status],
    );

    return (
        <main className="h-full overflow-y-auto bg-[#f7f7f5] text-stone-950 dark:bg-[#0d0d0c] dark:text-stone-100">
            <header className="border-b border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-950">
                <div className="mx-auto max-w-6xl px-6 py-8">
                    <div className="flex flex-wrap items-end justify-between gap-4">
                        <div>
                            <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-sky-600 dark:text-sky-400">
                                <Clock3 className="size-3.5" />
                                GENERATION QUEUE
                            </div>
                            <h1 className="text-3xl font-semibold">任务中心</h1>
                        </div>
                        <Button icon={<RefreshCw className="size-4" />} onClick={() => void refresh()}>
                            刷新
                        </Button>
                    </div>
                    <div className="mt-6 grid gap-3 lg:grid-cols-[auto_auto_minmax(240px,1fr)]">
                        <Segmented
                            value={status}
                            onChange={(value) => setStatus(value as StatusFilter)}
                            options={[
                                { label: "全部状态", value: "all" },
                                { label: "进行中", value: "running" },
                                { label: "已完成", value: "completed" },
                                { label: "失败", value: "failed" },
                            ]}
                        />
                        <Segmented
                            value={capability}
                            onChange={(value) => setCapability(value as CapabilityFilter)}
                            options={[
                                { label: "全部类型", value: "all" },
                                { label: "图片", value: "image" },
                                { label: "视频", value: "video" },
                            ]}
                        />
                        <Input allowClear value={keyword} prefix={<Search className="size-4 text-stone-400" />} placeholder="搜索任务、提示词或模型" onChange={(event) => setKeyword(event.target.value)} />
                    </div>
                </div>
            </header>

            <div className="mx-auto max-w-6xl px-6 py-7">
                {loading ? (
                    <div className="grid min-h-72 place-items-center">
                        <Spin />
                    </div>
                ) : filtered.length ? (
                    <div className="overflow-hidden rounded-lg border border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-950">
                        {filtered.map((item) => (
                            <TaskRow key={`${item.capability}-${item.id}`} item={item} onOpen={() => navigate(item.capability === "image" ? "/image" : "/video")} />
                        ))}
                    </div>
                ) : (
                    <div className="grid min-h-72 place-items-center border-y border-stone-200 dark:border-stone-800">
                        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有匹配的生成任务" />
                    </div>
                )}
            </div>
        </main>
    );
}

function TaskRow({ item, onOpen }: { item: GenerationTaskItem; onOpen: () => void }) {
    const CapabilityIcon = item.capability === "image" ? ImagePlus : Video;
    const meta = statusMeta[item.status];
    const StatusIcon = meta.icon;
    return (
        <button
            type="button"
            className="grid w-full gap-3 border-b border-stone-200 px-4 py-4 text-left transition last:border-b-0 hover:bg-stone-50 dark:border-stone-800 dark:hover:bg-stone-900 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center"
            onClick={onOpen}
        >
            <span className="grid size-10 place-items-center rounded-lg bg-stone-100 text-stone-600 dark:bg-stone-900 dark:text-stone-300">
                <CapabilityIcon className="size-4" />
            </span>
            <span className="min-w-0">
                <span className="flex flex-wrap items-center gap-2">
                    <strong className="truncate text-sm font-semibold">{item.title}</strong>
                    <Tag color={meta.color} icon={<StatusIcon className={`mr-1 inline size-3 ${item.status === "running" ? "animate-spin" : ""}`} />}>
                        {meta.label}
                    </Tag>
                </span>
                <span className="mt-1 block truncate text-xs text-stone-500 dark:text-stone-400">{item.prompt || item.model || "未记录提示词"}</span>
            </span>
            <span className="grid justify-items-start gap-1 text-xs text-stone-500 sm:justify-items-end dark:text-stone-400">
                <span>{item.resultLabel}</span>
                <span className="tabular-nums">
                    {new Date(item.createdAt).toLocaleString("zh-CN", { hour12: false })}
                    {item.durationMs ? ` · ${formatDuration(item.durationMs)}` : ""}
                </span>
            </span>
        </button>
    );
}
