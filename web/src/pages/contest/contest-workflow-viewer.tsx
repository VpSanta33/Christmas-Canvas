import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { App, Button, Segmented } from "antd";
import { Copy, ImageOff, Loader2, Music2, Video, X } from "lucide-react";

import { InfiniteCanvas } from "@/components/canvas/infinite-canvas";
import { ConnectionPath } from "@/components/canvas/canvas-connections";
import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import { CanvasNodeType, type CanvasNodeData, type ViewportTransform } from "@/types/canvas";
import { fetchContestSnapshotBlob, type ContestCanvasSnapshot } from "@/services/api/contest";
import { collectSnapshotStorageKeys } from "./contest-snapshot";

type ContestWorkflowViewerProps = {
    entryId: string;
    title: string;
    snapshot: ContestCanvasSnapshot;
    onClose: () => void;
    onCopyProject: () => Promise<void>;
};

// 只读工作流查看器：全屏浮层，复用 InfiniteCanvas 的缩放/平移与 ConnectionPath 连线，
// 节点渲染走独立的轻量只读卡片（不挂 store / 插件 / 编辑回调）。
export function ContestWorkflowViewer({ entryId, title, snapshot, onClose, onCopyProject }: ContestWorkflowViewerProps) {
    const { message } = App.useApp();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const containerRef = useRef<HTMLDivElement>(null);
    const [tab, setTab] = useState<"workflow" | "storyboard">("workflow");
    const [copying, setCopying] = useState(false);
    const [mediaUrls, setMediaUrls] = useState<Record<string, string>>({});

    const nodes = useMemo(() => (snapshot.nodes ?? []) as CanvasNodeData[], [snapshot.nodes]);
    const connections = useMemo(() => snapshot.connections ?? [], [snapshot.connections]);
    const nodeById = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);

    // 初始视口：把整个工作流缩放居中到视图内（fit-to-content）。
    const [viewport, setViewport] = useState<ViewportTransform>(snapshot.viewport ?? { x: 0, y: 0, k: 1 });
    useEffect(() => {
        const container = containerRef.current;
        if (!container || nodes.length === 0) return;
        const minX = Math.min(...nodes.map((n) => n.position.x));
        const minY = Math.min(...nodes.map((n) => n.position.y));
        const maxX = Math.max(...nodes.map((n) => n.position.x + n.width));
        const maxY = Math.max(...nodes.map((n) => n.position.y + n.height));
        const { width, height } = container.getBoundingClientRect();
        const padding = 120;
        const k = Math.min(1, Math.max(0.05, Math.min((width - padding) / (maxX - minX || 1), (height - padding) / (maxY - minY || 1))));
        setViewport({ k, x: width / 2 - ((minX + maxX) / 2) * k, y: height / 2 - ((minY + maxY) / 2) * k });
    }, [nodes]);

    // 解析作者媒体：快照里 metadata.content 是作者账号下的失效 blob URL，必须凭
    // storageKey 走大赛专用只读端点重新拉取（后端校验该 key 确属这件已过审作品）。
    useEffect(() => {
        const keys = collectSnapshotStorageKeys(snapshot);
        if (keys.length === 0) return;
        let alive = true;
        const created: string[] = [];
        void Promise.all(
            keys.map(async (key) => {
                try {
                    const blob = await fetchContestSnapshotBlob(entryId, key);
                    if (!alive) return null;
                    const url = URL.createObjectURL(blob);
                    created.push(url);
                    return [key, url] as const;
                } catch {
                    return null;
                }
            }),
        ).then((entries) => {
            if (!alive) return;
            setMediaUrls(Object.fromEntries(entries.filter((entry): entry is readonly [string, string] => entry !== null)));
        });
        return () => {
            alive = false;
            created.forEach((url) => URL.revokeObjectURL(url));
        };
    }, [entryId, snapshot]);

    const handleCopy = async () => {
        setCopying(true);
        try {
            await onCopyProject();
        } catch {
            message.error("复制项目失败");
        } finally {
            setCopying(false);
        }
    };

    // 故事板：抽出所有含图/视频的节点，按位置从上到下、从左到右排成分镜网格。
    const storyboardNodes = useMemo(() => nodes.filter((node) => node.type === CanvasNodeType.Image || node.type === CanvasNodeType.Video).sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x), [nodes]);

    return createPortal(
        <div className="fixed inset-0 z-[1200] flex flex-col" style={{ background: theme.canvas.background }}>
            <header className="flex items-center justify-between gap-4 px-5 py-3" style={{ borderBottom: `1px solid ${theme.node.stroke}` }}>
                <h2 className="min-w-0 truncate text-sm font-semibold" style={{ color: theme.node.text }}>
                    {title || "制作流程"}
                </h2>
                <Segmented
                    value={tab}
                    onChange={(v) => setTab(v as "workflow" | "storyboard")}
                    options={[
                        { label: "工作流", value: "workflow" },
                        { label: "故事板", value: "storyboard" },
                    ]}
                />
                <div className="flex items-center gap-2">
                    <span className="hidden text-xs sm:inline" style={{ color: theme.node.muted }}>
                        只读
                    </span>
                    <Button type="primary" icon={copying ? <Loader2 className="size-4 animate-spin" /> : <Copy className="size-4" />} loading={copying} onClick={() => void handleCopy()}>
                        复制项目
                    </Button>
                    <button type="button" aria-label="关闭" onClick={onClose} className="inline-flex size-8 items-center justify-center rounded-md transition hover:opacity-70" style={{ color: theme.node.text }}>
                        <X className="size-5" />
                    </button>
                </div>
            </header>

            <div className="relative min-h-0 flex-1">
                {tab === "workflow" ? (
                    <InfiniteCanvas containerRef={containerRef} viewport={viewport} onViewportChange={setViewport}>
                        <svg className="absolute left-0 top-0 h-[10000px] w-[10000px] overflow-visible" style={{ pointerEvents: "none", zIndex: 0 }}>
                            {connections.map((connection) => {
                                const from = nodeById.get(connection.fromNodeId);
                                const to = nodeById.get(connection.toNodeId);
                                if (!from || !to) return null;
                                return <ConnectionPath key={connection.id} connection={connection} from={from} to={to} active={false} onSelect={() => {}} />;
                            })}
                        </svg>
                        {nodes.map((node) => (
                            <ReadonlyNode key={node.id} node={node} mediaUrls={mediaUrls} theme={theme} />
                        ))}
                    </InfiniteCanvas>
                ) : (
                    <div className="h-full overflow-y-auto p-6">
                        {storyboardNodes.length === 0 ? (
                            <div className="flex h-full items-center justify-center text-sm" style={{ color: theme.node.muted }}>
                                该作品没有图像/视频分镜
                            </div>
                        ) : (
                            <div className="mx-auto grid max-w-5xl grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
                                {storyboardNodes.map((node) => (
                                    <figure key={node.id} className="space-y-1.5">
                                        <div className="aspect-square overflow-hidden rounded-lg" style={{ background: `${theme.node.fill}` }}>
                                            <ReadonlyMedia node={node} mediaUrls={mediaUrls} theme={theme} />
                                        </div>
                                        <figcaption className="truncate text-xs" style={{ color: theme.node.muted }}>
                                            {node.title || node.metadata?.prompt || "分镜"}
                                        </figcaption>
                                    </figure>
                                ))}
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>,
        document.body,
    );
}

// ReadonlyNode：镜像 CanvasNode 的世界坐标定位（translate + width/height），
// 但只渲染静态内容，无拖拽/缩放/连线交互。
function ReadonlyNode({ node, mediaUrls, theme }: { node: CanvasNodeData; mediaUrls: Record<string, string>; theme: (typeof canvasThemes)[keyof typeof canvasThemes] }) {
    const isGroup = node.type === CanvasNodeType.Group;
    const isMedia = node.type === CanvasNodeType.Image || node.type === CanvasNodeType.Video || node.type === CanvasNodeType.Audio;
    return (
        <div className="absolute flex select-none flex-col" style={{ transform: `translate(${node.position.x}px, ${node.position.y}px)`, width: node.width, height: node.height, zIndex: isGroup ? 5 : 10 }}>
            <div className="absolute left-3 top-[-24px] max-w-[calc(100%-24px)] truncate text-xs font-medium opacity-75" style={{ color: theme.node.text }}>
                {node.title || "未命名节点"}
            </div>
            <div
                className="relative h-full w-full overflow-hidden rounded-lg border-2"
                style={{
                    background: isGroup || isMedia ? "transparent" : theme.node.fill,
                    borderColor: isGroup ? theme.node.stroke : theme.node.stroke,
                    borderStyle: isGroup ? "dashed" : "solid",
                }}
            >
                {isMedia ? (
                    <ReadonlyMedia node={node} mediaUrls={mediaUrls} theme={theme} />
                ) : (
                    <div className="h-full w-full overflow-auto whitespace-pre-wrap p-3 text-xs leading-5" style={{ color: theme.node.text }}>
                        {node.metadata?.content || node.metadata?.prompt || ""}
                    </div>
                )}
            </div>
        </div>
    );
}

// ReadonlyMedia：按 storageKey 从已解析的作者媒体里取 URL，未命中时回退到快照里的
// 原始 content（本地导出场景可能是 dataURL）。加载中/失败给占位符。
function ReadonlyMedia({ node, mediaUrls, theme }: { node: CanvasNodeData; mediaUrls: Record<string, string>; theme: (typeof canvasThemes)[keyof typeof canvasThemes] }) {
    const key = node.metadata?.storageKey;
    const fallback = node.metadata?.content && node.metadata.content.startsWith("data:") ? node.metadata.content : "";
    const url = (key && mediaUrls[key]) || fallback;

    if (!url) {
        const Icon = node.type === CanvasNodeType.Video ? Video : node.type === CanvasNodeType.Audio ? Music2 : key ? Loader2 : ImageOff;
        return (
            <div className="flex h-full w-full items-center justify-center" style={{ color: theme.node.placeholder }}>
                <Icon className={`size-6 opacity-40 ${key ? "animate-spin" : ""}`} />
            </div>
        );
    }
    if (node.type === CanvasNodeType.Video) return <video src={url} controls playsInline className="h-full w-full bg-black object-contain" data-canvas-no-zoom />;
    if (node.type === CanvasNodeType.Audio)
        return (
            <div className="flex h-full w-full items-center px-3">
                <audio src={url} controls className="w-full" data-canvas-no-zoom />
            </div>
        );
    return <img src={url} alt={node.title} draggable={false} className="pointer-events-none h-full w-full select-none object-contain" />;
}
