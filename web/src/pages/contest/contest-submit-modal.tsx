import { useRef, useState } from "react";
import { App, Button, Input, Modal, Segmented, Select } from "antd";
import { FileVideo, Sparkles, Upload, WandSparkles, Workflow, X } from "lucide-react";
import { nanoid } from "nanoid";

import { createContestEntry, type ContestCanvasSnapshot, type ContestRecipeType } from "@/services/api/contest";
import { uploadBlobToBackend } from "@/services/backend/media-backend";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";

import { captureVideoCover } from "./contest-media";

type ContestSubmitModalProps = {
    open: boolean;
    onClose: () => void;
    onSuccess: () => void;
};

const maxVideoBytes = 100 * 1024 * 1024;

export function ContestSubmitModal({ open, onClose, onSuccess }: ContestSubmitModalProps) {
    const { message } = App.useApp();
    const inputRef = useRef<HTMLInputElement>(null);
    const [file, setFile] = useState<File | null>(null);
    const [previewUrl, setPreviewUrl] = useState("");
    const [title, setTitle] = useState("");
    const [description, setDescription] = useState("");
    const [recipeType, setRecipeType] = useState<ContestRecipeType>("prompt");
    const [recipeContent, setRecipeContent] = useState("");
    const [projectId, setProjectId] = useState<string | undefined>(undefined);
    const [submitting, setSubmitting] = useState(false);

    const projects = useCanvasStore((state) => state.projects);
    const openProject = useCanvasStore((state) => state.openProject);

    const reset = () => {
        if (previewUrl) URL.revokeObjectURL(previewUrl);
        setFile(null);
        setPreviewUrl("");
        setTitle("");
        setDescription("");
        setRecipeType("prompt");
        setRecipeContent("");
        setProjectId(undefined);
        if (inputRef.current) inputRef.current.value = "";
    };

    const close = () => {
        if (submitting) return;
        reset();
        onClose();
    };

    const selectFile = (next?: File) => {
        if (!next) return;
        if (!next.type.startsWith("video/")) {
            message.error("请选择视频文件");
            return;
        }
        if (next.size > maxVideoBytes) {
            message.error("视频不能超过 100MB");
            return;
        }
        if (previewUrl) URL.revokeObjectURL(previewUrl);
        setFile(next);
        setPreviewUrl(URL.createObjectURL(next));
        if (!title.trim()) setTitle(next.name.replace(/\.[^.]+$/, ""));
    };

    const submit = async () => {
        if (!file || !title.trim() || !recipeContent.trim()) {
            message.warning("请补全视频、作品标题和创作配方");
            return;
        }
        setSubmitting(true);
        try {
            const cover = await captureVideoCover(file);
            const [video, coverFile] = await Promise.all([uploadBlobToBackend(`contest-video:${nanoid()}`, file), uploadBlobToBackend(`contest-cover:${nanoid()}`, cover)]);
            // 关联画布后，把整份工作流快照随作品提交，供他人只读查看与复制项目。
            let canvasSnapshot: ContestCanvasSnapshot | null = null;
            if (projectId) {
                const project = openProject(projectId);
                if (project) {
                    canvasSnapshot = {
                        title: project.title,
                        nodes: project.nodes,
                        connections: project.connections,
                        chatSessions: project.chatSessions,
                        backgroundMode: project.backgroundMode,
                        showImageInfo: project.showImageInfo,
                        viewport: project.viewport,
                    };
                }
            }
            await createContestEntry({
                videoStorageKey: video.storageKey,
                coverStorageKey: coverFile.storageKey,
                title: title.trim(),
                description: description.trim(),
                recipeType,
                recipeContent: recipeContent.trim(),
                canvasSnapshot,
            });
            message.success("投稿已提交，正在等待审核");
            reset();
            onClose();
            onSuccess();
        } catch (error) {
            message.error(error instanceof Error ? error.message : "投稿失败，请稍后再试");
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <Modal open={open} onCancel={close} title="发布视频作品" width={720} footer={null} destroyOnHidden>
            <div className="space-y-5 pt-2">
                <input ref={inputRef} type="file" accept="video/mp4,video/webm,video/quicktime,video/*" hidden onChange={(event) => selectFile(event.target.files?.[0])} />

                {file && previewUrl ? (
                    <div className="relative aspect-video overflow-hidden rounded-lg bg-black">
                        <video src={previewUrl} controls className="size-full object-contain" />
                        <button
                            type="button"
                            className="absolute right-3 top-3 grid size-8 place-items-center rounded-full bg-black/60 text-white backdrop-blur transition hover:bg-black/80"
                            onClick={() => {
                                URL.revokeObjectURL(previewUrl);
                                setPreviewUrl("");
                                setFile(null);
                            }}
                            aria-label="移除视频"
                        >
                            <X className="size-4" />
                        </button>
                    </div>
                ) : (
                    <button
                        type="button"
                        className="flex aspect-video w-full flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-stone-300 bg-stone-50 text-stone-500 transition hover:border-stone-400 hover:bg-stone-100 dark:border-stone-700 dark:bg-stone-950 dark:text-stone-400 dark:hover:border-stone-600 dark:hover:bg-stone-900"
                        onClick={() => inputRef.current?.click()}
                    >
                        <span className="grid size-12 place-items-center rounded-full bg-stone-900 text-white dark:bg-stone-100 dark:text-stone-950">
                            <FileVideo className="size-5" />
                        </span>
                        <span className="text-sm font-medium text-stone-800 dark:text-stone-200">选择参赛视频</span>
                        <span className="text-xs">MP4 / WebM / MOV，最大 100MB</span>
                    </button>
                )}

                <div className="grid gap-4 sm:grid-cols-2">
                    <label className="space-y-2">
                        <span className="text-sm font-medium">作品标题</span>
                        <Input value={title} maxLength={80} showCount placeholder="给作品起一个名字" onChange={(event) => setTitle(event.target.value)} />
                    </label>
                    <label className="space-y-2">
                        <span className="text-sm font-medium">创作配方</span>
                        <Segmented
                            block
                            value={recipeType}
                            onChange={(value) => setRecipeType(value as ContestRecipeType)}
                            options={[
                                {
                                    value: "prompt",
                                    label: (
                                        <span className="inline-flex items-center gap-1.5">
                                            <WandSparkles className="size-3.5" />
                                            提示词
                                        </span>
                                    ),
                                },
                                {
                                    value: "skill",
                                    label: (
                                        <span className="inline-flex items-center gap-1.5">
                                            <Sparkles className="size-3.5" />
                                            Skill
                                        </span>
                                    ),
                                },
                            ]}
                        />
                    </label>
                </div>

                <label className="block space-y-2">
                    <span className="text-sm font-medium">
                        作品简介 <span className="font-normal text-stone-400">可选</span>
                    </span>
                    <Input.TextArea value={description} rows={2} maxLength={500} showCount placeholder="介绍创作思路、风格或适用场景" onChange={(event) => setDescription(event.target.value)} />
                </label>

                <label className="block space-y-2">
                    <span className="text-sm font-medium">{recipeType === "skill" ? "Skill 内容" : "完整提示词"}</span>
                    <Input.TextArea
                        value={recipeContent}
                        rows={9}
                        maxLength={20000}
                        showCount
                        className="font-mono"
                        placeholder={recipeType === "skill" ? "粘贴可复用的视频创作 Skill，包含角色、镜头、节奏和输出要求..." : "粘贴生成这条视频使用的完整提示词..."}
                        onChange={(event) => setRecipeContent(event.target.value)}
                    />
                </label>

                <label className="block space-y-2">
                    <span className="inline-flex items-center gap-1.5 text-sm font-medium">
                        <Workflow className="size-3.5" />
                        关联制作流程 <span className="font-normal text-stone-400">可选</span>
                    </span>
                    <Select
                        value={projectId}
                        onChange={setProjectId}
                        allowClear
                        placeholder="选择一个画布，观众可查看并一键复制你的完整工作流"
                        className="w-full"
                        options={projects.map((project) => ({ value: project.id, label: `${project.title}（${project.nodes.length} 个节点）` }))}
                        notFoundContent="暂无画布"
                    />
                    <span className="block text-xs text-stone-400">关联后，其他用户可在只读模式查看你的节点画布，并复制项目继续创作。</span>
                </label>

                <div className="flex items-center justify-between gap-4 border-t border-stone-200 pt-4 dark:border-stone-800">
                    <p className="text-xs leading-5 text-stone-500">发布后需经管理员审核方可展示。观众可查看并直接使用你的创作配方；点赞不会自动发放积分，奖励由管理员参考人气统一结算。</p>
                    <div className="flex shrink-0 gap-2">
                        <Button onClick={close} disabled={submitting}>
                            取消
                        </Button>
                        <Button type="primary" icon={<Upload className="size-4" />} loading={submitting} onClick={() => void submit()}>
                            发布作品
                        </Button>
                    </div>
                </div>
            </div>
        </Modal>
    );
}
