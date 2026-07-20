import { Check, Clipboard, FolderOpen, ImageDown, Save } from "lucide-react";
import { Button, Input, Select, Slider, Tooltip } from "antd";

import { aspectRatioOptions, compositionOptions, lightingOptions, movementOptions, shotSizeOptions } from "@/pages/director/director-prompt";
import type { CanvasProject } from "@/stores/canvas/use-canvas-store";
import type { DirectorAspectRatio, DirectorComposition, DirectorLighting, DirectorMovement, DirectorShot, DirectorShotSize } from "@/types/director";

type DirectorControlsProps = {
    shot: DirectorShot;
    prompt: string;
    projects: CanvasProject[];
    selectedCanvasId?: string;
    saving: boolean;
    addingToCanvas: boolean;
    onShotChange: (patch: Partial<DirectorShot>) => void;
    onCanvasChange: (id: string) => void;
    onCopyPrompt: () => void;
    onSaveShot: () => void;
    onAddToCanvas: () => void;
    onOpenCanvas: () => void;
};

export function DirectorControls({ shot, prompt, projects, selectedCanvasId, saving, addingToCanvas, onShotChange, onCanvasChange, onCopyPrompt, onSaveShot, onAddToCanvas, onOpenCanvas }: DirectorControlsProps) {
    return (
        <div className="director-side-content director-controls">
            <div className="director-panel-heading">
                <div>
                    <span className="director-kicker">CAMERA CONTROL</span>
                    <h2>导演控制</h2>
                </div>
                <span className="director-status">
                    <i /> LIVE
                </span>
            </div>

            <div className="director-controls-scroll thin-scrollbar">
                <ControlSection title="镜头">
                    <label className="director-field">
                        <span>镜头名称</span>
                        <Input value={shot.title} maxLength={40} onChange={(event) => onShotChange({ title: event.target.value })} />
                    </label>
                    <div className="director-field-grid">
                        <label className="director-field">
                            <span>景别</span>
                            <Select value={shot.shotSize} options={shotSizeOptions.map(({ value, label }) => ({ value, label }))} onChange={(value) => onShotChange({ shotSize: value as DirectorShotSize })} />
                        </label>
                        <label className="director-field">
                            <span>画幅</span>
                            <Select value={shot.aspectRatio} options={aspectRatioOptions.map((value) => ({ value, label: value }))} onChange={(value) => onShotChange({ aspectRatio: value as DirectorAspectRatio })} />
                        </label>
                    </div>
                    <DirectorSlider label="焦距" value={shot.focalLength} min={18} max={135} step={1} suffix="mm" onChange={(focalLength) => onShotChange({ focalLength })} />
                    <div className="director-lens-presets" aria-label="常用焦距">
                        {[24, 35, 50, 85].map((lens) => (
                            <button key={lens} type="button" className={shot.focalLength === lens ? "is-active" : ""} onClick={() => onShotChange({ focalLength: lens })}>
                                {lens}
                            </button>
                        ))}
                    </div>
                </ControlSection>

                <ControlSection title="机位">
                    <DirectorSlider label="方位" value={shot.yaw} min={-180} max={180} step={1} suffix="°" onChange={(yaw) => onShotChange({ yaw })} />
                    <DirectorSlider label="俯仰" value={shot.pitch} min={-45} max={45} step={1} suffix="°" onChange={(pitch) => onShotChange({ pitch })} />
                    <DirectorSlider label="倾斜" value={shot.roll} min={-20} max={20} step={1} suffix="°" onChange={(roll) => onShotChange({ roll })} />
                </ControlSection>

                <ControlSection title="调度">
                    <label className="director-field">
                        <span>构图</span>
                        <Select value={shot.composition} options={compositionOptions.map(({ value, label }) => ({ value, label }))} onChange={(value) => onShotChange({ composition: value as DirectorComposition })} />
                    </label>
                    <label className="director-field">
                        <span>灯光</span>
                        <Select value={shot.lighting} options={lightingOptions.map(({ value, label }) => ({ value, label }))} onChange={(value) => onShotChange({ lighting: value as DirectorLighting })} />
                    </label>
                    <label className="director-field">
                        <span>运镜</span>
                        <Select value={shot.movement} options={movementOptions.map(({ value, label }) => ({ value, label }))} onChange={(value) => onShotChange({ movement: value as DirectorMovement })} />
                    </label>
                </ControlSection>

                <ControlSection
                    title="镜头提示词"
                    action={
                        <Tooltip title="复制提示词">
                            <button type="button" className="director-section-action" onClick={onCopyPrompt} aria-label="复制提示词">
                                <Clipboard className="size-3.5" />
                            </button>
                        </Tooltip>
                    }
                >
                    <textarea className="director-prompt" value={prompt} readOnly aria-label="镜头提示词" />
                </ControlSection>

                <ControlSection title="输出">
                    <label className="director-field">
                        <span>目标画布</span>
                        <div className="director-canvas-select">
                            <Select value={selectedCanvasId} placeholder="自动新建分镜画布" allowClear options={projects.map((project) => ({ value: project.id, label: project.title }))} onChange={(value) => onCanvasChange(value || "")} />
                            <Tooltip title="打开画布">
                                <Button disabled={!selectedCanvasId} icon={<FolderOpen className="size-4" />} onClick={onOpenCanvas} aria-label="打开目标画布" />
                            </Tooltip>
                        </div>
                    </label>
                    <div className="director-output-actions">
                        <Button block icon={shot.previewUrl ? <Check className="size-4" /> : <Save className="size-4" />} loading={saving} onClick={onSaveShot}>
                            {shot.previewUrl ? "更新镜头素材" : "保存镜头素材"}
                        </Button>
                        <Button block type="primary" icon={<ImageDown className="size-4" />} loading={addingToCanvas} onClick={onAddToCanvas}>
                            加入画布
                        </Button>
                    </div>
                </ControlSection>
            </div>
        </div>
    );
}

function ControlSection({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
    return (
        <section className="director-control-section">
            <header>
                <h3>{title}</h3>
                {action}
            </header>
            <div className="director-control-body">{children}</div>
        </section>
    );
}

function DirectorSlider({ label, value, min, max, step, suffix, onChange }: { label: string; value: number; min: number; max: number; step: number; suffix: string; onChange: (value: number) => void }) {
    return (
        <div className="director-slider-field">
            <div>
                <span>{label}</span>
                <output>
                    {value}
                    {suffix}
                </output>
            </div>
            <Slider min={min} max={max} step={step} value={value} tooltip={{ formatter: null }} onChange={onChange} />
        </div>
    );
}
