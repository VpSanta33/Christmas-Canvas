import { Button, Progress, Tooltip } from "antd";
import { AlertTriangle, CheckCircle2, CloudUpload, LoaderCircle, RotateCcw, Trash2, X } from "lucide-react";
import { useState } from "react";

import { formatBytes } from "@/lib/image-utils";
import {
    cancelMediaUpload,
    discardMediaUpload,
    retryAllMediaUploads,
    retryMediaUpload,
    useMediaUploadQueue,
} from "@/services/media-upload-queue";

export function MediaUploadQueue() {
    const records = useMediaUploadQueue();
    const [collapsed, setCollapsed] = useState(false);
    if (!records.length) return null;
    const failedCount = records.filter((item) => item.status === "failed").length;
    return (
        <aside className="fixed bottom-4 right-4 z-50 w-[min(360px,calc(100vw-2rem))] overflow-hidden rounded-lg border border-stone-200 bg-background shadow-[0_18px_50px_rgba(28,25,23,0.16)] dark:border-stone-800 dark:shadow-[0_18px_50px_rgba(0,0,0,0.45)]">
            <button type="button" className="flex h-11 w-full items-center justify-between border-b border-stone-200 px-3 text-left dark:border-stone-800" onClick={() => setCollapsed((value) => !value)}>
                <span className="flex items-center gap-2 text-sm font-medium">
                    <CloudUpload className="size-4 text-sky-500" />
                    作品传输
                    <span className="text-xs font-normal text-stone-400">{records.length}</span>
                </span>
                <span className="text-xs text-stone-500">{failedCount ? `${failedCount} 个待重试` : collapsed ? "展开" : "收起"}</span>
            </button>
            {!collapsed ? (
                <div>
                    {failedCount ? (
                        <div className="flex items-center justify-between border-b border-stone-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-stone-800 dark:bg-amber-950/30 dark:text-amber-300">
                            <span>生成结果仍保存在浏览器，可安全重试。</span>
                            <Button size="small" type="text" icon={<RotateCcw className="size-3.5" />} onClick={() => void retryAllMediaUploads()}>全部重试</Button>
                        </div>
                    ) : null}
                    <div className="max-h-72 divide-y divide-stone-200 overflow-y-auto dark:divide-stone-800">
                        {records.map((record) => (
                            <div key={record.storageKey} className="px-3 py-2.5">
                                <div className="flex items-start gap-2.5">
                                    <span className={`mt-0.5 grid size-7 shrink-0 place-items-center rounded-full ${record.status === "failed" ? "bg-red-50 text-red-500 dark:bg-red-950/40" : record.status === "completed" ? "bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40" : "bg-sky-50 text-sky-600 dark:bg-sky-950/40"}`}>
                                        {record.status === "failed" ? <AlertTriangle className="size-3.5" /> : record.status === "completed" ? <CheckCircle2 className="size-3.5" /> : <LoaderCircle className="size-3.5 animate-spin" />}
                                    </span>
                                    <div className="min-w-0 flex-1">
                                        <div className="flex items-center justify-between gap-2 text-xs">
                                            <span className="font-medium text-stone-800 dark:text-stone-200">{kindLabel(record.kind)} · {formatBytes(record.bytes)}</span>
                                            <span className="text-stone-400">{record.status === "uploading" ? `${record.progress}%` : record.status === "completed" ? "已保存" : `第 ${record.attempts} 次失败`}</span>
                                        </div>
                                        {record.status === "uploading" ? <Progress percent={record.progress} showInfo={false} size="small" className="!mb-0 !mt-1" /> : null}
                                        {record.status === "failed" ? <p className="mt-1 line-clamp-2 text-[11px] leading-4 text-red-500">{record.error}</p> : null}
                                        {record.status === "completed" ? <p className="mt-1 truncate font-mono text-[10px] text-stone-400" title={record.objectKey}>{record.objectKey}</p> : null}
                                    </div>
                                    <div className="flex shrink-0">
                                        {record.status === "uploading" ? (
                                            <Tooltip title="取消上传"><Button type="text" size="small" icon={<X className="size-3.5" />} onClick={() => cancelMediaUpload(record.storageKey)} aria-label="取消上传" /></Tooltip>
                                        ) : record.status === "failed" ? (
                                            <>
                                                <Tooltip title="重新上传"><Button type="text" size="small" icon={<RotateCcw className="size-3.5" />} onClick={() => void retryMediaUpload(record.storageKey)} aria-label="重新上传" /></Tooltip>
                                                <Tooltip title="放弃并删除本地恢复文件"><Button type="text" size="small" danger icon={<Trash2 className="size-3.5" />} onClick={() => void discardMediaUpload(record.storageKey)} aria-label="放弃上传" /></Tooltip>
                                            </>
                                        ) : null}
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            ) : null}
        </aside>
    );
}

function kindLabel(kind: string) {
    if (kind === "image" || kind === "contest-cover") return "图片";
    if (kind === "video" || kind.includes("video")) return "视频";
    if (kind === "audio" || kind.includes("audio")) return "音频";
    return "文件";
}
