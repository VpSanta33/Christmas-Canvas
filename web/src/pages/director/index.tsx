import { lazy, Suspense, useMemo, useRef, useState, type CSSProperties } from "react";
import { useNavigate } from "react-router-dom";
import { App, Button, ConfigProvider, Drawer, Input, Spin, theme as antdTheme, Tooltip } from "antd";
import { Camera, ImagePlus, PanelLeftOpen, RotateCcw, SlidersHorizontal, Trash2 } from "lucide-react";
import { nanoid } from "nanoid";

import { fitNodeSize } from "@/lib/canvas/canvas-node-size";
import { imageMetadata } from "@/lib/canvas/canvas-node-factory";
import { useCopyText } from "@/hooks/use-copy-text";
import { buildDirectorPrompt } from "@/pages/director/director-prompt";
import { DirectorControls } from "@/pages/director/director-controls";
import { DirectorShotList } from "@/pages/director/director-shot-list";
import type { DirectorSceneHandle } from "@/pages/director/director-scene";
import { uploadImage, type UploadedImage } from "@/services/image-storage";
import { useAssetStore } from "@/stores/use-asset-store";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { useDirectorStore } from "@/stores/use-director-store";
import { CanvasNodeType } from "@/types/canvas";
import type { DirectorComposition, DirectorSceneSettings, DirectorShot } from "@/types/director";
import "./director.css";

const DirectorScene = lazy(() => import("@/pages/director/director-scene").then((module) => ({ default: module.DirectorScene })));

export default function DirectorPage() {
    const { message, modal } = App.useApp();
    const copyText = useCopyText();
    const navigate = useNavigate();
    const sceneRef = useRef<DirectorSceneHandle>(null);
    const panoramaInputRef = useRef<HTMLInputElement>(null);
    const [shotDrawerOpen, setShotDrawerOpen] = useState(false);
    const [controlsDrawerOpen, setControlsDrawerOpen] = useState(false);
    const [saving, setSaving] = useState(false);
    const [addingToCanvas, setAddingToCanvas] = useState(false);
    const [uploadingPanorama, setUploadingPanorama] = useState(false);
    const [selectedCanvasId, setSelectedCanvasId] = useState<string | undefined>(undefined);

    const hydrated = useDirectorStore((state) => state.hydrated);
    const sceneTitle = useDirectorStore((state) => state.sceneTitle);
    const sceneDescription = useDirectorStore((state) => state.sceneDescription);
    const subjectDescription = useDirectorStore((state) => state.subjectDescription);
    const panoramaUrl = useDirectorStore((state) => state.panoramaUrl);
    const shots = useDirectorStore((state) => state.shots);
    const activeShotId = useDirectorStore((state) => state.activeShotId);
    const updateScene = useDirectorStore((state) => state.updateScene);
    const addShot = useDirectorStore((state) => state.addShot);
    const duplicateShot = useDirectorStore((state) => state.duplicateShot);
    const removeShot = useDirectorStore((state) => state.removeShot);
    const moveShot = useDirectorStore((state) => state.moveShot);
    const selectShot = useDirectorStore((state) => state.selectShot);
    const updateShot = useDirectorStore((state) => state.updateShot);
    const projects = useCanvasStore((state) => state.projects);
    const createProject = useCanvasStore((state) => state.createProject);
    const updateProject = useCanvasStore((state) => state.updateProject);
    const addAsset = useAssetStore((state) => state.addAsset);
    const cleanupImages = useAssetStore((state) => state.cleanupImages);

    const activeShot = shots.find((shot) => shot.id === activeShotId) || shots[0];
    const sceneSettings = useMemo<DirectorSceneSettings>(() => ({ sceneTitle, sceneDescription, subjectDescription, panoramaUrl }), [panoramaUrl, sceneDescription, sceneTitle, subjectDescription]);
    const prompt = useMemo(() => (activeShot ? buildDirectorPrompt(sceneSettings, activeShot) : ""), [activeShot, sceneSettings]);
    const effectiveCanvasId = selectedCanvasId === undefined ? projects[0]?.id : selectedCanvasId;

    if (!hydrated || !activeShot) {
        return (
            <div className="flex h-full items-center justify-center bg-[#101314]">
                <Spin />
            </div>
        );
    }

    const changeShot = (patch: Partial<DirectorShot>) => {
        const next = { ...activeShot, ...patch };
        updateShot(activeShot.id, { ...patch, prompt: buildDirectorPrompt(sceneSettings, next) });
    };

    const changeScene = (patch: Partial<DirectorSceneSettings>) => {
        const nextScene = { ...sceneSettings, ...patch };
        updateScene(patch);
        updateShot(activeShot.id, { prompt: buildDirectorPrompt(nextScene, activeShot) });
    };

    const captureShot = async (): Promise<UploadedImage> => {
        const blob = await sceneRef.current?.capture();
        if (!blob) throw new Error("取景器尚未准备完成");
        const image = await uploadImage(blob);
        updateShot(activeShot.id, {
            prompt,
            previewUrl: image.url,
            previewStorageKey: image.storageKey,
            previewWidth: image.width,
            previewHeight: image.height,
        });
        return image;
    };

    const saveShotAsset = async () => {
        setSaving(true);
        try {
            const image = await captureShot();
            addAsset({
                kind: "image",
                title: `${sceneTitle} · ${activeShot.title}`,
                coverUrl: image.url,
                tags: ["导演台", activeShot.shotSize, activeShot.lighting],
                source: "导演台",
                note: prompt,
                data: { dataUrl: "", storageKey: image.storageKey, width: image.width, height: image.height, bytes: image.bytes, mimeType: image.mimeType },
                metadata: { source: "director", shotId: activeShot.id, prompt, camera: cameraMetadata(activeShot) },
            });
            cleanupImages();
            message.success("镜头截图已保存到我的资产");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "保存镜头失败");
        } finally {
            setSaving(false);
        }
    };

    const addShotToCanvas = async () => {
        setAddingToCanvas(true);
        try {
            const image = await captureShot();
            let projectId = effectiveCanvasId;
            if (!projectId || !useCanvasStore.getState().projects.some((project) => project.id === projectId)) {
                projectId = createProject(`${sceneTitle} 分镜`);
                setSelectedCanvasId(projectId);
            }
            const project = useCanvasStore.getState().openProject(projectId);
            if (!project) throw new Error("目标画布不存在");
            const size = fitNodeSize(image.width, image.height, 480, 320);
            const maxRight = project.nodes.reduce((value, node) => Math.max(value, node.position.x + node.width), -80);
            const node = {
                id: `image-${nanoid()}`,
                type: CanvasNodeType.Image,
                title: activeShot.title,
                position: { x: maxRight + 80, y: 0 },
                width: size.width,
                height: size.height,
                metadata: { ...imageMetadata(image), prompt, source: "director", directorShotId: activeShot.id },
            };
            updateProject(projectId, { nodes: [...project.nodes, node] });
            cleanupImages();
            message.success(`已加入「${project.title}」`);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "加入画布失败");
        } finally {
            setAddingToCanvas(false);
        }
    };

    const uploadPanorama = async (file?: File) => {
        if (!file) return;
        setUploadingPanorama(true);
        try {
            const image = await uploadImage(file);
            changeScene({ panoramaUrl: image.url, panoramaStorageKey: image.storageKey });
            if (image.width / image.height < 1.7) message.warning("建议使用 2:1 等距柱状全景图");
            else message.success("全景片场已载入");
            cleanupImages();
        } catch (error) {
            message.error(error instanceof Error ? error.message : "全景图载入失败");
        } finally {
            setUploadingPanorama(false);
            if (panoramaInputRef.current) panoramaInputRef.current.value = "";
        }
    };

    const deleteShot = (id: string) => {
        const shot = shots.find((item) => item.id === id);
        if (!shot || shots.length === 1) return;
        modal.confirm({
            title: `删除「${shot.title}」？`,
            content: "素材库中已经保存的截图不会被删除。",
            okText: "删除",
            okButtonProps: { danger: true },
            cancelText: "取消",
            onOk: () => {
                removeShot(id);
                cleanupImages();
            },
        });
    };

    const shotList = (
        <DirectorShotList
            shots={shots}
            activeShotId={activeShot.id}
            sceneDescription={sceneDescription}
            subjectDescription={subjectDescription}
            onSceneDescriptionChange={(value) => changeScene({ sceneDescription: value })}
            onSubjectDescriptionChange={(value) => changeScene({ subjectDescription: value })}
            onSelect={selectShot}
            onAdd={addShot}
            onDuplicate={duplicateShot}
            onDelete={deleteShot}
            onMove={moveShot}
        />
    );
    const controls = (
        <DirectorControls
            shot={activeShot}
            prompt={prompt}
            projects={projects}
            selectedCanvasId={effectiveCanvasId}
            saving={saving}
            addingToCanvas={addingToCanvas}
            onShotChange={changeShot}
            onCanvasChange={setSelectedCanvasId}
            onCopyPrompt={() => copyText(prompt, "镜头提示词已复制")}
            onSaveShot={() => void saveShotAsset()}
            onAddToCanvas={() => void addShotToCanvas()}
            onOpenCanvas={() => effectiveCanvasId && navigate(`/canvas/${effectiveCanvasId}`)}
        />
    );
    const frameRatio = aspectRatioValue(activeShot.aspectRatio);

    return (
        <ConfigProvider
            theme={{
                algorithm: antdTheme.darkAlgorithm,
                token: { colorPrimary: "#f0b94b", colorInfo: "#f0b94b", colorBgContainer: "#191d1e", colorBorder: "#353b3d", colorText: "#e8e7e2", borderRadius: 4 },
                components: { Button: { primaryColor: "#15130e", primaryShadow: "none" }, Slider: { railBg: "#343a3c", railHoverBg: "#424a4c", trackBg: "#d69d36", trackHoverBg: "#efb94f", handleColor: "#efb94f" } },
            }}
        >
            <main className="director-studio">
                <header className="director-toolbar">
                    <div className="director-toolbar-group">
                        <Tooltip title="镜头清单">
                            <button type="button" className="director-icon-button director-mobile-only" onClick={() => setShotDrawerOpen(true)} aria-label="打开镜头清单">
                                <PanelLeftOpen className="size-4" />
                            </button>
                        </Tooltip>
                        <Camera className="size-4 text-[#e2ac43]" />
                        <Input className="director-scene-title" variant="borderless" value={sceneTitle} maxLength={36} onChange={(event) => changeScene({ sceneTitle: event.target.value })} />
                        <span className="director-shot-count">{shots.length} SHOTS</span>
                    </div>
                    <div className="director-toolbar-center">
                        <span>{activeShot.title}</span>
                        <b>{activeShot.focalLength}mm</b>
                        <span>{activeShot.aspectRatio}</span>
                    </div>
                    <div className="director-toolbar-group">
                        {panoramaUrl ? (
                            <Tooltip title="移除全景图">
                                <button
                                    type="button"
                                    className="director-icon-button"
                                    onClick={() => {
                                        changeScene({ panoramaUrl: undefined, panoramaStorageKey: undefined });
                                        cleanupImages();
                                    }}
                                    aria-label="移除全景图"
                                >
                                    <Trash2 className="size-4" />
                                </button>
                            </Tooltip>
                        ) : null}
                        <Button size="small" icon={<ImagePlus className="size-4" />} loading={uploadingPanorama} onClick={() => panoramaInputRef.current?.click()}>
                            全景图
                        </Button>
                        <Tooltip title="复位机位">
                            <button type="button" className="director-icon-button" onClick={() => sceneRef.current?.resetCamera()} aria-label="复位机位">
                                <RotateCcw className="size-4" />
                            </button>
                        </Tooltip>
                        <Tooltip title="导演控制">
                            <button type="button" className="director-icon-button director-mobile-only" onClick={() => setControlsDrawerOpen(true)} aria-label="打开导演控制">
                                <SlidersHorizontal className="size-4" />
                            </button>
                        </Tooltip>
                    </div>
                </header>

                <div className="director-workspace">
                    <aside className="director-left-panel director-desktop-panel">{shotList}</aside>
                    <section className="director-stage" aria-label="三维取景器">
                        <div className="director-viewport" style={{ "--director-frame-ratio": frameRatio } as CSSProperties}>
                            <Suspense
                                fallback={
                                    <div className="director-scene-loading">
                                        <Spin />
                                    </div>
                                }
                            >
                                <DirectorScene ref={sceneRef} shot={activeShot} panoramaUrl={panoramaUrl} onCameraChange={(angles) => changeShot(angles)} />
                            </Suspense>
                            <CompositionGuide composition={activeShot.composition} />
                            <div className="director-view-meta director-view-meta-top">
                                <span>
                                    <i /> LIVE VIEW
                                </span>
                                <b>{activeShot.title}</b>
                            </div>
                            <div className="director-view-meta director-view-meta-bottom">
                                <span>Y {signed(activeShot.yaw)}°</span>
                                <span>P {signed(activeShot.pitch)}°</span>
                                <span>R {signed(activeShot.roll)}°</span>
                                <b>{activeShot.focalLength} MM</b>
                            </div>
                        </div>
                    </section>
                    <aside className="director-right-panel director-desktop-panel">{controls}</aside>
                </div>

                <input ref={panoramaInputRef} type="file" accept="image/*" className="hidden" onChange={(event) => void uploadPanorama(event.target.files?.[0])} />
                <Drawer title="镜头清单" placement="left" size={320} open={shotDrawerOpen} onClose={() => setShotDrawerOpen(false)} rootClassName="director-mobile-drawer">
                    {shotList}
                </Drawer>
                <Drawer title="导演控制" placement="right" size={340} open={controlsDrawerOpen} onClose={() => setControlsDrawerOpen(false)} rootClassName="director-mobile-drawer">
                    {controls}
                </Drawer>
            </main>
        </ConfigProvider>
    );
}

function CompositionGuide({ composition }: { composition: DirectorComposition }) {
    return (
        <div className={`director-guide director-guide-${composition}`} aria-hidden="true">
            {composition === "thirds" ? (
                <>
                    <i className="v1" />
                    <i className="v2" />
                    <i className="h1" />
                    <i className="h2" />
                </>
            ) : null}
            {composition === "center" ? (
                <>
                    <i className="center-v" />
                    <i className="center-h" />
                    <b />
                </>
            ) : null}
            {composition === "symmetry" ? (
                <>
                    <i className="center-v" />
                    <span className="safe-frame" />
                </>
            ) : null}
            {composition === "golden" ? (
                <>
                    <i className="gold-v" />
                    <i className="gold-h" />
                    <b />
                </>
            ) : null}
            {composition === "headroom" ? (
                <>
                    <span className="safe-frame" />
                    <i className="head-line" />
                </>
            ) : null}
        </div>
    );
}

function cameraMetadata(shot: DirectorShot) {
    return { yaw: shot.yaw, pitch: shot.pitch, roll: shot.roll, focalLength: shot.focalLength, shotSize: shot.shotSize, composition: shot.composition, lighting: shot.lighting, movement: shot.movement, aspectRatio: shot.aspectRatio };
}

function aspectRatioValue(value: DirectorShot["aspectRatio"]) {
    const [width, height] = value.split(":").map(Number);
    return width / height;
}

function signed(value: number) {
    return value > 0 ? `+${value}` : String(value);
}
