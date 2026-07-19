import { useEffect, type ReactNode } from "react";
import { Segmented, Slider, Switch } from "antd";

import { ImageSettingsTheme } from "@/components/image-settings-panel";
import { boolConfig, isSeedanceFastModel, isSeedanceVideoConfig, normalizeSeedanceDuration, normalizeSeedanceRatio, normalizeSeedanceResolution, seedancePixelLabel, seedanceRatioOptions, seedanceResolutionOptions } from "@/lib/seedance-video";
import { normalizeViraldanceDuration, normalizeViraldanceRatio, viraldanceProfile, viraldanceSizeForRatio } from "@/lib/viraldance-video";
import { type CanvasTheme } from "@/lib/canvas-theme";
import { configuredVideoQualities } from "@/lib/generation-cost";
import { modelOptionName, VIDEO_SECONDS_MAX, VIDEO_SECONDS_MIN, type AiConfig } from "@/stores/use-config-store";

const sizeOptions = [
    { value: "1280x720", label: "横屏", width: 1280, height: 720 },
    { value: "720x1280", label: "竖屏", width: 720, height: 1280 },
    { value: "1024x1024", label: "方形", width: 1024, height: 1024 },
    { value: "1792x1024", label: "宽屏", width: 1792, height: 1024 },
    { value: "1024x1792", label: "长图", width: 1024, height: 1792 },
    { value: "auto", label: "auto", width: 0, height: 0 },
];

export const videoSizeOptions = sizeOptions.map((item) => ({ value: item.value, label: item.label }));

type VideoSettingsPanelProps = {
    config: AiConfig;
    onConfigChange: (key: "vquality" | "size" | "videoSeconds" | "videoGenerateAudio" | "videoWatermark" | "videoInputMode", value: string) => void;
    theme: CanvasTheme;
    showTitle?: boolean;
    className?: string;
};

export function VideoSettingsPanel({ config, onConfigChange, theme, showTitle = true, className = "w-[320px] space-y-4 rounded-2xl px-1 py-0.5" }: VideoSettingsPanelProps) {
    if (viraldanceProfile(modelOptionName(config.model || config.videoModel))) {
        return <ViraldanceVideoSettingsPanel config={config} onConfigChange={onConfigChange} theme={theme} showTitle={showTitle} className={className} />;
    }
    if (isSeedanceVideoConfig(config)) {
        return <SeedanceVideoSettingsPanel config={config} onConfigChange={onConfigChange} theme={theme} showTitle={showTitle} className={className} />;
    }
    return <GenericVideoSettingsPanel config={config} onConfigChange={onConfigChange} theme={theme} showTitle={showTitle} className={className} />;
}

function ViraldanceVideoSettingsPanel({ config, onConfigChange, theme, showTitle, className }: VideoSettingsPanelProps) {
    const model = modelOptionName(config.model || config.videoModel);
    const profile = viraldanceProfile(model)!;
    const ratio = normalizeViraldanceRatio(config.size, model);
    const duration = normalizeViraldanceDuration(config.videoSeconds);

    useEffect(() => {
        if (normalizeVideoResolutionValue(config.vquality) !== "720") onConfigChange("vquality", "720");
        if (config.size !== ratio) onConfigChange("size", ratio);
        if (config.videoSeconds !== String(duration)) onConfigChange("videoSeconds", String(duration));
        if (profile.variant === "900" && config.videoInputMode !== "reference") onConfigChange("videoInputMode", "reference");
    }, [config.size, config.videoInputMode, config.videoSeconds, config.vquality, duration, onConfigChange, profile.variant, ratio]);

    return (
        <ImageSettingsTheme theme={theme}>
            <div className={className} style={{ color: theme.node.text }} onMouseDown={(event) => event.stopPropagation()}>
                {showTitle ? <div className="text-lg font-semibold">视频设置</div> : null}
                <SettingGroup title="分辨率" color={theme.node.muted}>
                    <div className="grid grid-cols-3 gap-2.5">
                        <OptionPill selected theme={theme} onClick={() => onConfigChange("vquality", "720")}>
                            720p
                        </OptionPill>
                    </div>
                </SettingGroup>
                <SettingGroup title="比例" color={theme.node.muted}>
                    <div className="grid grid-cols-3 gap-2.5">
                        {profile.ratios.map((item) => {
                            const dimensions = readSizeDimensions(viraldanceSizeForRatio(item, model));
                            return (
                                <button
                                    key={item}
                                    type="button"
                                    className="flex h-[68px] cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border bg-transparent px-1 text-sm transition hover:opacity-80"
                                    style={{ borderColor: ratio === item ? theme.node.text : theme.node.stroke, color: theme.node.text }}
                                    onMouseDown={(event) => event.stopPropagation()}
                                    onClick={() => onConfigChange("size", item)}
                                >
                                    <SizePreview width={dimensions.width} height={dimensions.height} color={theme.node.text} />
                                    <span>{item === "16:9" ? "横屏" : item === "9:16" ? "竖屏" : "方形"}</span>
                                    <span className="text-[10px] leading-none opacity-55">{viraldanceSizeForRatio(item, model)}</span>
                                </button>
                            );
                        })}
                    </div>
                </SettingGroup>
                <SettingGroup title="时长" color={theme.node.muted}>
                    <DurationSlider value={duration} min={4} max={VIDEO_SECONDS_MAX} theme={theme} onChange={(value) => onConfigChange("videoSeconds", String(value))} />
                </SettingGroup>
                {profile.variant === "431" ? (
                    <SettingGroup title="图片模式" color={theme.node.muted}>
                        <Segmented
                            block
                            value={config.videoInputMode === "first-last" ? "first-last" : "reference"}
                            options={[
                                { label: "素材参考", value: "reference" },
                                { label: "首尾帧", value: "first-last" },
                            ]}
                            onChange={(value) => onConfigChange("videoInputMode", String(value))}
                        />
                    </SettingGroup>
                ) : null}
            </div>
        </ImageSettingsTheme>
    );
}

function GenericVideoSettingsPanel({ config, onConfigChange, theme, showTitle, className }: VideoSettingsPanelProps) {
    const resolutionOptions = configuredVideoQualities(config).map((value) => ({ value, label: `${value}p` }));
    const normalizedResolution = normalizeVideoResolutionValue(config.vquality);
    const resolution = resolutionOptions.some((item) => item.value === normalizedResolution) ? normalizedResolution : resolutionOptions[0]?.value || normalizedResolution;
    const seconds = clampSeconds(config.videoSeconds, VIDEO_SECONDS_MIN);
    const size = normalizeVideoSizeValue(config.size);
    const dimensions = readSizeDimensions(size);

    useEffect(() => {
        if (resolution && normalizeVideoResolutionValue(config.vquality) !== resolution) onConfigChange("vquality", resolution);
    }, [config.vquality, onConfigChange, resolution]);

    const updateDimension = (key: "width" | "height", value: number | null) => {
        const next = Math.max(1, Math.floor(value || dimensions[key] || 720));
        onConfigChange("size", `${key === "width" ? next : dimensions.width}x${key === "height" ? next : dimensions.height}`);
    };

    return (
        <ImageSettingsTheme theme={theme}>
            <div className={className} style={{ color: theme.node.text }} onMouseDown={(event) => event.stopPropagation()}>
                {showTitle ? <div className="text-lg font-semibold">视频设置</div> : null}
                <SettingGroup title="清晰度" color={theme.node.muted}>
                    <div className="grid grid-cols-3 gap-2.5">
                        {resolutionOptions.map((item) => (
                            <OptionPill key={item.value} selected={resolution === item.value} theme={theme} onClick={() => onConfigChange("vquality", item.value)}>
                                {item.label}
                            </OptionPill>
                        ))}
                    </div>
                    {!resolutionOptions.length ? <UnavailableHint>管理员暂未配置可用的视频分辨率。</UnavailableHint> : null}
                </SettingGroup>
                <SettingGroup title="尺寸" color={theme.node.muted}>
                    <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2.5">
                        <DimensionInput prefix="W" value={dimensions.width} disabled={size === "auto"} theme={theme} onChange={(value) => updateDimension("width", value)} />
                        <span className="text-lg opacity-45">↔</span>
                        <DimensionInput prefix="H" value={dimensions.height} disabled={size === "auto"} theme={theme} onChange={(value) => updateDimension("height", value)} />
                    </div>
                    <div className="grid grid-cols-3 gap-2.5">
                        {sizeOptions.map((item) => (
                            <button
                                key={item.value}
                                type="button"
                                className="flex h-[78px] cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border bg-transparent text-sm transition hover:opacity-80"
                                style={{ borderColor: size === item.value ? theme.node.text : theme.node.stroke, color: theme.node.text }}
                                onMouseDown={(event) => event.stopPropagation()}
                                onClick={() => onConfigChange("size", item.value)}
                            >
                                <SizePreview width={item.width} height={item.height} color={theme.node.text} />
                                <span>{item.label}</span>
                                {item.value === "auto" ? null : <span className="text-[11px] leading-none opacity-55">{item.value}</span>}
                            </button>
                        ))}
                    </div>
                </SettingGroup>
                <SettingGroup title="时长" color={theme.node.muted}>
                    <DurationSlider value={seconds} min={VIDEO_SECONDS_MIN} max={VIDEO_SECONDS_MAX} theme={theme} onChange={(value) => onConfigChange("videoSeconds", String(value))} />
                </SettingGroup>
            </div>
        </ImageSettingsTheme>
    );
}

function SeedanceVideoSettingsPanel({ config, onConfigChange, theme, showTitle, className }: VideoSettingsPanelProps) {
    const model = modelOptionName(config.model || config.videoModel);
    const configuredQualities = new Set(configuredVideoQualities(config));
    const resolutionOptions = seedanceResolutionOptions.filter((item) => configuredQualities.has(item.value.replace(/p$/, "")) && !(item.value === "1080p" && isSeedanceFastModel(model)));
    const normalizedResolution = normalizeSeedanceResolution(config.vquality, model);
    const resolution = resolutionOptions.some((item) => item.value === normalizedResolution) ? normalizedResolution : resolutionOptions[0]?.value || normalizedResolution;
    const ratio = normalizeSeedanceRatio(config.size);
    const duration = normalizeSeedanceDuration(config.videoSeconds);
    const generateAudio = boolConfig(config.videoGenerateAudio, true);
    const watermark = boolConfig(config.videoWatermark, false);

    useEffect(() => {
        if (resolution && normalizeSeedanceResolution(config.vquality, model) !== resolution) onConfigChange("vquality", resolution);
    }, [config.vquality, model, onConfigChange, resolution]);

    return (
        <ImageSettingsTheme theme={theme}>
            <div className={className} style={{ color: theme.node.text }} onMouseDown={(event) => event.stopPropagation()}>
                {showTitle ? <div className="text-lg font-semibold">视频设置</div> : null}
                <SettingGroup title="分辨率" color={theme.node.muted}>
                    <div className="grid grid-cols-3 gap-2.5">
                        {resolutionOptions.map((item) => (
                            <OptionPill key={item.value} selected={resolution === item.value} theme={theme} onClick={() => onConfigChange("vquality", item.value)}>
                                {item.label}
                            </OptionPill>
                        ))}
                    </div>
                    {isSeedanceFastModel(model) ? <div className="text-[11px] leading-4 opacity-55">fast 模型不支持 1080p，会自动使用 720p。</div> : null}
                    {!resolutionOptions.length ? <UnavailableHint>后台价格表中没有该模型支持的分辨率。</UnavailableHint> : null}
                </SettingGroup>
                <SettingGroup title="比例" color={theme.node.muted}>
                    <div className="grid grid-cols-3 gap-2.5">
                        {seedanceRatioOptions.map((item) => (
                            <button
                                key={item.value}
                                type="button"
                                className="flex h-[68px] cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border bg-transparent px-1 text-sm transition hover:opacity-80"
                                style={{ borderColor: ratio === item.value ? theme.node.text : theme.node.stroke, color: theme.node.text }}
                                onMouseDown={(event) => event.stopPropagation()}
                                onClick={() => onConfigChange("size", item.value)}
                            >
                                <SizePreview width={ratioPreview(item.value).width} height={ratioPreview(item.value).height} color={theme.node.text} />
                                <span>{item.label}</span>
                                <span className="text-[10px] leading-none opacity-55">{item.value === "adaptive" ? "adaptive" : seedancePixelLabel(resolution, item.value)}</span>
                            </button>
                        ))}
                    </div>
                </SettingGroup>
                <SettingGroup title="时长" color={theme.node.muted}>
                    <DurationSlider value={duration} min={4} max={VIDEO_SECONDS_MAX} theme={theme} onChange={(value) => onConfigChange("videoSeconds", String(value))} />
                    <div className="text-[11px] leading-4 opacity-55">该模型最低支持 4 秒，其他视频模型可从 1 秒开始选择。</div>
                </SettingGroup>
                <SettingGroup title="输出" color={theme.node.muted}>
                    <div className="grid gap-2 rounded-xl border p-2.5" style={{ borderColor: theme.node.stroke }}>
                        <SwitchRow label="生成声音" checked={generateAudio} theme={theme} onChange={(checked) => onConfigChange("videoGenerateAudio", String(checked))} />
                        <SwitchRow label="添加水印" checked={watermark} theme={theme} onChange={(checked) => onConfigChange("videoWatermark", String(checked))} />
                    </div>
                </SettingGroup>
            </div>
        </ImageSettingsTheme>
    );
}

export function videoResolutionLabel(value: string) {
    return `${normalizeVideoResolutionValue(value)}p`;
}

export function videoSizeLabel(value: string) {
    const ratio = normalizeSeedanceRatio(value);
    if (value === "adaptive" || value === "auto") return "自适应";
    if (ratio === value) return seedanceRatioOptions.find((item) => item.value === ratio)?.label || ratio;
    const size = normalizeVideoSizeValue(value);
    return sizeOptions.find((item) => item.value === size)?.label || size;
}

export function videoSecondsLabel(value: string, config?: AiConfig) {
    const model = config ? modelOptionName(config.model || config.videoModel) : "";
    return `${clampSeconds(value, config && (isSeedanceVideoConfig(config) || viraldanceProfile(model)) ? 4 : VIDEO_SECONDS_MIN)}s`;
}

export function normalizeVideoSizeValue(value: string) {
    if (value === "auto") return "auto";
    if (/^\d+x\d+$/.test(value || "")) return value;
    return ["9:16", "2:3", "3:4"].includes(value) ? "720x1280" : "1280x720";
}

export function normalizeVideoResolutionValue(value: string) {
    if (value === "480p" || value === "low") return "480";
    if (value === "720p" || value === "auto" || value === "high" || value === "medium") return "720";
    return value.replace(/p$/i, "") || "720";
}

function OptionPill({ selected, disabled = false, theme, onClick, children }: { selected: boolean; disabled?: boolean; theme: CanvasTheme; onClick: () => void; children: ReactNode }) {
    return (
        <button
            type="button"
            disabled={disabled}
            className="h-9 cursor-pointer rounded-full border px-2 text-sm transition hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-35"
            style={{ background: "transparent", borderColor: selected ? theme.node.text : theme.node.stroke, color: theme.node.text }}
            onMouseDown={(event) => event.stopPropagation()}
            onClick={onClick}
        >
            {children}
        </button>
    );
}

function SettingGroup({ title, color, children }: { title: string; color: string; children: ReactNode }) {
    return (
        <div className="space-y-2.5">
            <div className="text-xs font-medium" style={{ color }}>
                {title}
            </div>
            {children}
        </div>
    );
}

function UnavailableHint({ children }: { children: ReactNode }) {
    return <div className="rounded-lg border border-dashed px-3 py-2 text-[11px] leading-4 opacity-55">{children}</div>;
}

function DurationSlider({ value, min, max, theme, onChange }: { value: number; min: number; max: number; theme: CanvasTheme; onChange: (value: number) => void }) {
    return (
        <div className="rounded-xl border px-4 pb-1 pt-3" style={{ borderColor: theme.node.stroke, background: theme.node.fill }}>
            <div className="mb-1 flex items-baseline justify-between gap-3">
                <span className="text-[11px]" style={{ color: theme.node.muted }}>
                    {min}–{max} 秒，步进 1 秒
                </span>
                <span className="text-xl font-semibold tabular-nums">
                    {value}
                    <span className="ml-1 text-xs font-normal" style={{ color: theme.node.muted }}>
                        秒
                    </span>
                </span>
            </div>
            <Slider min={min} max={max} step={1} value={value} marks={{ [min]: `${min}s`, [max]: `${max}s` }} tooltip={{ formatter: (next) => `${next} 秒` }} onChange={onChange} />
        </div>
    );
}

function clampSeconds(value: string, min: number) {
    return Math.max(min, Math.min(VIDEO_SECONDS_MAX, Math.floor(Number(value) || min)));
}

function DimensionInput({ prefix, value, disabled, theme, onChange }: { prefix: string; value: number; disabled: boolean; theme: CanvasTheme; onChange: (value: number | null) => void }) {
    return (
        <label className="flex h-9 overflow-hidden rounded-xl text-sm" style={{ background: theme.node.fill, color: theme.node.text, opacity: disabled ? 0.55 : 1 }}>
            <span className="grid w-9 place-items-center" style={{ color: theme.node.muted }}>
                {prefix}
            </span>
            <input
                type="number"
                min={1}
                disabled={disabled}
                className="min-w-0 flex-1 bg-transparent px-2 outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                value={value || ""}
                onChange={(event) => onChange(Number(event.target.value) || null)}
                onMouseDown={(event) => event.stopPropagation()}
            />
        </label>
    );
}

function SizePreview({ width, height, color }: { width: number; height: number; color: string }) {
    if (!width || !height) return null;
    const longSide = Math.max(width, height);
    const previewWidth = Math.max(10, Math.round((width / longSide) * 26));
    const previewHeight = Math.max(10, Math.round((height / longSide) * 26));
    return <span className="rounded-[3px] border-2" style={{ width: previewWidth, height: previewHeight, borderColor: color }} />;
}

function ratioPreview(ratio: string) {
    if (ratio === "9:16") return { width: 9, height: 16 };
    if (ratio === "1:1") return { width: 1, height: 1 };
    if (ratio === "4:3") return { width: 4, height: 3 };
    if (ratio === "3:4") return { width: 3, height: 4 };
    if (ratio === "21:9") return { width: 21, height: 9 };
    if (ratio === "adaptive") return { width: 0, height: 0 };
    return { width: 16, height: 9 };
}

function SwitchRow({ label, checked, theme, onChange }: { label: string; checked: boolean; theme: CanvasTheme; onChange: (checked: boolean) => void }) {
    return (
        <div className="flex h-8 items-center justify-between gap-3">
            <span className="text-sm" style={{ color: theme.node.text }}>
                {label}
            </span>
            <span onMouseDown={(event) => event.stopPropagation()}>
                <Switch size="small" checked={checked} onChange={onChange} />
            </span>
        </div>
    );
}

function readSizeDimensions(size: string) {
    if (size === "auto") return { width: 0, height: 0 };
    const match = size.match(/^(\d+)x(\d+)$/);
    return { width: Number(match?.[1]) || 1280, height: Number(match?.[2]) || 720 };
}
