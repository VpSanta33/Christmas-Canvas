import { ArrowDown, ArrowUp, Clapperboard, Copy, Plus, Trash2 } from "lucide-react";
import { Input, Tooltip } from "antd";

import { compositionOptions, lightingOptions, shotSizeOptions } from "@/pages/director/director-prompt";
import { cn } from "@/lib/utils";
import type { DirectorShot } from "@/types/director";

type DirectorShotListProps = {
    shots: DirectorShot[];
    activeShotId: string;
    sceneDescription: string;
    subjectDescription: string;
    onSceneDescriptionChange: (value: string) => void;
    onSubjectDescriptionChange: (value: string) => void;
    onSelect: (id: string) => void;
    onAdd: () => void;
    onDuplicate: (id: string) => void;
    onDelete: (id: string) => void;
    onMove: (id: string, direction: -1 | 1) => void;
};

export function DirectorShotList({ shots, activeShotId, sceneDescription, subjectDescription, onSceneDescriptionChange, onSubjectDescriptionChange, onSelect, onAdd, onDuplicate, onDelete, onMove }: DirectorShotListProps) {
    return (
        <div className="director-side-content">
            <div className="director-panel-heading">
                <div>
                    <span className="director-kicker">SHOT LIST</span>
                    <h2>镜头清单</h2>
                </div>
                <Tooltip title="新增镜头">
                    <button type="button" className="director-icon-button" onClick={onAdd} aria-label="新增镜头">
                        <Plus className="size-4" />
                    </button>
                </Tooltip>
            </div>

            <div className="director-scene-fields">
                <label>
                    <span>场景</span>
                    <Input.TextArea value={sceneDescription} autoSize={{ minRows: 2, maxRows: 3 }} maxLength={160} onChange={(event) => onSceneDescriptionChange(event.target.value)} />
                </label>
                <label>
                    <span>主体</span>
                    <Input.TextArea value={subjectDescription} autoSize={{ minRows: 2, maxRows: 3 }} maxLength={120} onChange={(event) => onSubjectDescriptionChange(event.target.value)} />
                </label>
            </div>

            <div className="director-shot-scroll thin-scrollbar">
                {shots.map((shot, index) => {
                    const selected = shot.id === activeShotId;
                    const shotSize = shotSizeOptions.find((item) => item.value === shot.shotSize)?.label;
                    const lighting = lightingOptions.find((item) => item.value === shot.lighting)?.label;
                    const composition = compositionOptions.find((item) => item.value === shot.composition)?.label;
                    return (
                        <article key={shot.id} className={cn("director-shot-item", selected && "is-active")}>
                            <button type="button" className="director-shot-main" onClick={() => onSelect(shot.id)} aria-current={selected ? "true" : undefined}>
                                <div className="director-shot-preview">
                                    {shot.previewUrl ? <img src={shot.previewUrl} alt="" /> : <Clapperboard className="size-5" />}
                                    <span>{String(index + 1).padStart(2, "0")}</span>
                                </div>
                                <div className="min-w-0 flex-1 text-left">
                                    <strong>{shot.title}</strong>
                                    <p>
                                        {shotSize} · {shot.focalLength}mm · {shot.aspectRatio}
                                    </p>
                                    <small>
                                        {composition} / {lighting}
                                    </small>
                                </div>
                            </button>
                            <div className="director-shot-actions">
                                <Tooltip title="上移">
                                    <button type="button" disabled={index === 0} onClick={() => onMove(shot.id, -1)} aria-label="上移镜头">
                                        <ArrowUp className="size-3.5" />
                                    </button>
                                </Tooltip>
                                <Tooltip title="下移">
                                    <button type="button" disabled={index === shots.length - 1} onClick={() => onMove(shot.id, 1)} aria-label="下移镜头">
                                        <ArrowDown className="size-3.5" />
                                    </button>
                                </Tooltip>
                                <Tooltip title="复制">
                                    <button type="button" onClick={() => onDuplicate(shot.id)} aria-label="复制镜头">
                                        <Copy className="size-3.5" />
                                    </button>
                                </Tooltip>
                                <Tooltip title="删除">
                                    <button type="button" disabled={shots.length === 1} onClick={() => onDelete(shot.id)} aria-label="删除镜头">
                                        <Trash2 className="size-3.5" />
                                    </button>
                                </Tooltip>
                            </div>
                        </article>
                    );
                })}
            </div>
        </div>
    );
}
