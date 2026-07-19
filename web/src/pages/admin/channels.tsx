import { useEffect, useMemo, useState } from "react";
import { App, Button, Form, Input, InputNumber, Modal, Select, Space, Switch, Table, Tag, Tooltip } from "antd";
import { Plus, Save, SlidersHorizontal, Trash2 } from "lucide-react";

import {
    createChannel,
    deleteChannel,
    fetchModelDefaults,
    listChannels,
    setChannelEnabled,
    testChannel,
    testChannelDraft,
    updateChannel,
    updateChannelModelPricing,
    updateModelDefaults,
    type AdminChannel,
    type ChannelModel,
    type ChannelPayload,
    type ModelDefaults,
} from "@/services/api/admin";
import { syncBackendChannels } from "@/services/api/channels";
import { defaultGenerationPricing, VIDEO_SECOND_KEYS, type GenerationPricing } from "@/stores/use-config-store";
import { extractErrorMessage } from "@/utils/http-error";

const CAPABILITY_OPTIONS = [
    { value: "image", label: "图像 image" },
    { value: "video", label: "视频 video" },
    { value: "audio", label: "音频 audio" },
    { value: "text", label: "文本 text" },
];

const API_FORMAT_OPTIONS = [
    { value: "openai", label: "OpenAI 兼容" },
    { value: "gemini", label: "Gemini" },
];

const DEFAULT_MODEL_FIELDS: Array<{ key: keyof ModelDefaults; label: string; description: string }> = [
    { key: "image", label: "默认生图模型", description: "首页与生图工作台首次使用" },
    { key: "video", label: "默认视频模型", description: "视频创作与画布视频节点" },
    { key: "text", label: "默认文本模型", description: "文本问答与 Agent 能力" },
    { key: "audio", label: "默认音频模型", description: "语音与音频生成节点" },
];

const emptyModelDefaults: ModelDefaults = { image: "", video: "", text: "", audio: "" };

const IMAGE_QUALITY_FIELDS = [
    { key: "auto", label: "自动", description: "未指定清晰度" },
    { key: "low", label: "低清", description: "低分辨率输出" },
    { key: "medium", label: "标准", description: "标准分辨率输出" },
    { key: "high", label: "高清", description: "高分辨率输出" },
] as const;

function sortVideoQualities(values: string[]) {
    return [...values].sort((a, b) => Number(a) - Number(b) || a.localeCompare(b));
}

function sortVideoDurations(values: string[]) {
    return [...values].sort((a, b) => Number(a) - Number(b));
}

function durationLabel(value: string) {
    return `${value} 秒`;
}

function normalizePoints(value: number | null) {
    return Math.max(0, Math.min(1_000_000, Math.floor(Number(value) || 0)));
}

function videoDurations(_pricing?: GenerationPricing) {
    return sortVideoDurations(VIDEO_SECOND_KEYS);
}

function completeVideoPricingMatrix(pricing: GenerationPricing): GenerationPricing {
    const durations = videoDurations(pricing);
    return {
        ...pricing,
        videoPrices: Object.fromEntries(Object.entries(pricing.videoPrices).map(([quality, prices]) => [quality, Object.fromEntries(durations.map((duration) => [duration, prices[duration] ?? 0]))])),
    };
}

// 依模型名猜测能力，减少批量添加后逐个改能力的成本。
function guessCapability(name: string): string {
    const n = name.toLowerCase();
    if (/(sora|veo|video|seedance|viraldance|kling|runway|wan)/.test(n)) return "video";
    if (/(tts|audio|speech|whisper|voice|music|suno)/.test(n)) return "audio";
    if (/(image|dall|flux|sd|stable|imagen|seedream|gpt-image|midjourney|mj)/.test(n)) return "image";
    return "text";
}

type FormValues = {
    name: string;
    baseUrl: string;
    apiKey?: string;
    apiFormat: string;
    models: ChannelModel[];
    enabled: boolean;
    priority: number;
    keyExpiresAt?: string;
};

type ModelPricingTarget = {
    value: string;
    label: string;
    channelId: string;
    modelName: string;
    capability: "image" | "video";
    generationPricing?: GenerationPricing;
};

function modelPricingTargets(channels: AdminChannel[]): ModelPricingTarget[] {
    return channels.flatMap((channel) =>
        channel.models.flatMap((model) => {
            if (model.capability !== "image" && model.capability !== "video") return [];
            return [
                {
                    value: `${channel.id}::${model.name}`,
                    label: `${model.name}（${channel.name}）`,
                    channelId: channel.id,
                    modelName: model.name,
                    capability: model.capability,
                    generationPricing: model.generationPricing,
                },
            ];
        }),
    );
}

function pricingDraft(target: ModelPricingTarget | undefined, fallback: GenerationPricing) {
    return completeVideoPricingMatrix(structuredClone(target?.generationPricing || fallback));
}

export default function AdminChannelsPage() {
    const { message, modal } = App.useApp();
    const [form] = Form.useForm<FormValues>();
    const [channels, setChannels] = useState<AdminChannel[]>([]);
    const [modelDefaults, setModelDefaults] = useState<ModelDefaults>(emptyModelDefaults);
    const [failoverEnabled, setFailoverEnabled] = useState(true);
    const [fallbackGenerationPricing, setFallbackGenerationPricing] = useState<GenerationPricing>(() => structuredClone(defaultGenerationPricing));
    const [generationPricing, setGenerationPricing] = useState<GenerationPricing>(() => structuredClone(defaultGenerationPricing));
    const [pricingTarget, setPricingTarget] = useState("");
    const [videoQualityDraft, setVideoQualityDraft] = useState("");
    const [loading, setLoading] = useState(true);
    const [savingDefaults, setSavingDefaults] = useState(false);
    const [savingPricing, setSavingPricing] = useState(false);
    const [modalOpen, setModalOpen] = useState(false);
    const [editing, setEditing] = useState<AdminChannel | null>(null);
    const [saving, setSaving] = useState(false);
    const [testingId, setTestingId] = useState<string | null>(null); // 表格里正在测试的渠道 id
    const [draftTesting, setDraftTesting] = useState(false); // 弹窗内"测试连接"进行中
    const [fetchingModels, setFetchingModels] = useState(false); // 正在拉取模型列表
    const [modelPicker, setModelPicker] = useState<string[] | null>(null); // 拉到的模型名（打开选择弹窗）
    const [pickedModels, setPickedModels] = useState<string[]>([]); // 选中待添加的模型名

    const defaultModelOptions = useMemo(() => {
        const grouped: Record<keyof ModelDefaults, Array<{ label: string; value: string }>> = { image: [], video: [], text: [], audio: [] };
        channels.forEach((channel) => {
            if (!channel.enabled) return;
            channel.models.forEach((model) => {
                if (model.enabled === false || !(model.capability in grouped)) return;
                const capability = model.capability as keyof ModelDefaults;
                grouped[capability].push({ label: `${model.name}（${channel.name}）`, value: `${channel.id}::${model.name}` });
            });
        });
        return grouped;
    }, [channels]);

    const pricingTargets = useMemo(() => modelPricingTargets(channels), [channels]);
    const selectedPricingTarget = pricingTargets.find((target) => target.value === pricingTarget);

    // 把探测结果统一成一条消息展示。
    const reportHealth = (health: { ok: boolean; status: number; latencyMs: number; models: string[]; message: string }) => {
        if (health.ok) {
            const modelHint = health.models.length ? `，拉到 ${health.models.length} 个模型` : "";
            message.success(`连接正常（${health.latencyMs}ms，HTTP ${health.status}）${modelHint}`);
        } else {
            message.error(health.message || `连接失败（HTTP ${health.status || "无响应"}）`);
        }
    };

    const testSaved = async (channel: AdminChannel) => {
        setTestingId(channel.id);
        try {
            reportHealth(await testChannel(channel.id));
        } catch (error) {
            message.error(extractErrorMessage(error, "测试失败"));
        } finally {
            setTestingId(null);
        }
    };

    const testDraft = async () => {
        const values = form.getFieldsValue();
        if (!values.baseUrl) {
            message.warning("请先填写 Base URL 再测试");
            return;
        }
        // 编辑且未改密钥时，用已保存渠道的密钥测试（后端会回退到存储的 key）。
        if (editing && !values.apiKey) {
            await testSaved(editing);
            return;
        }
        if (!values.apiKey) {
            message.warning("请先填写 API Key 再测试");
            return;
        }
        setDraftTesting(true);
        try {
            reportHealth(
                await testChannelDraft({
                    baseUrl: values.baseUrl,
                    apiKey: values.apiKey,
                    apiFormat: values.apiFormat || "openai",
                }),
            );
        } catch (error) {
            message.error(extractErrorMessage(error, "测试失败"));
        } finally {
            setDraftTesting(false);
        }
    };

    // 通过测试端点拉取渠道模型列表（后端 HealthResult.models），供管理员快速勾选接入。
    const fetchModels = async () => {
        const values = form.getFieldsValue();
        if (!values.baseUrl) {
            message.warning("请先填写 Base URL");
            return;
        }
        setFetchingModels(true);
        try {
            const health =
                editing && !values.apiKey
                    ? await testChannel(editing.id)
                    : values.apiKey
                      ? await testChannelDraft({
                            baseUrl: values.baseUrl,
                            apiKey: values.apiKey,
                            apiFormat: values.apiFormat || "openai",
                        })
                      : null;
            if (!health) {
                message.warning("请先填写 API Key");
                return;
            }
            if (!health.ok) {
                message.error(health.message || `连接失败（HTTP ${health.status || "无响应"}）`);
                return;
            }
            if (!health.models.length) {
                message.info("连接正常，但该渠道未返回模型列表");
                return;
            }
            // 过滤掉已在表单中的模型，避免重复添加。
            const existing = new Set((form.getFieldValue("models") as ChannelModel[] | undefined)?.map((m) => m.name));
            const available = health.models.filter((name) => !existing.has(name));
            if (!available.length) {
                message.info("拉到的模型均已添加");
                return;
            }
            setModelPicker(available);
            setPickedModels(available);
        } catch (error) {
            message.error(extractErrorMessage(error, "获取模型失败"));
        } finally {
            setFetchingModels(false);
        }
    };

    // 把选中的模型名追加进 Form.List（默认能力 image、免费）。
    const applyPickedModels = () => {
        const current = (form.getFieldValue("models") as ChannelModel[] | undefined) ?? [];
        const added: ChannelModel[] = pickedModels.map((name, index) => ({
            name,
            capability: guessCapability(name),
            cost: 0,
            enabled: true,
            sortOrder: current.length + index,
        }));
        form.setFieldValue("models", [...current, ...added]);
        message.success(`已添加 ${added.length} 个模型`);
        setModelPicker(null);
        setPickedModels([]);
    };

    const load = async () => {
        setLoading(true);
        try {
            const [items, operations] = await Promise.all([listChannels(), fetchModelDefaults()]);
            setChannels(items);
            setModelDefaults(operations.defaults);
            setFailoverEnabled(operations.failoverEnabled);
            const fallback = completeVideoPricingMatrix(operations.generationPricing);
            const targets = modelPricingTargets(items);
            const target = targets.find((item) => item.value === pricingTarget) || targets[0];
            setFallbackGenerationPricing(fallback);
            setPricingTarget(target?.value || "");
            setGenerationPricing(pricingDraft(target, fallback));
        } catch (error) {
            message.error(extractErrorMessage(error, "加载模型运营设置失败"));
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        let alive = true;
        Promise.all([listChannels(), fetchModelDefaults()])
            .then(([items, operations]) => {
                if (!alive) return;
                setChannels(items);
                setModelDefaults(operations.defaults);
                setFailoverEnabled(operations.failoverEnabled);
                const fallback = completeVideoPricingMatrix(operations.generationPricing);
                const target = modelPricingTargets(items)[0];
                setFallbackGenerationPricing(fallback);
                setPricingTarget(target?.value || "");
                setGenerationPricing(pricingDraft(target, fallback));
            })
            .catch((error) => alive && message.error(extractErrorMessage(error, "加载模型运营设置失败")))
            .finally(() => alive && setLoading(false));
        return () => {
            alive = false;
        };
    }, [message]);

    const openCreate = () => {
        setEditing(null);
        form.setFieldsValue({ name: "", baseUrl: "", apiKey: "", apiFormat: "openai", models: [], enabled: true, priority: 100, keyExpiresAt: "" });
        setModalOpen(true);
    };

    const openEdit = (channel: AdminChannel) => {
        setEditing(channel);
        form.setFieldsValue({
            name: channel.name,
            baseUrl: channel.baseUrl,
            apiKey: "",
            apiFormat: channel.apiFormat,
            models: (channel.models ?? []).map((model, index) => ({ ...model, enabled: model.enabled !== false, sortOrder: model.sortOrder ?? index })),
            enabled: channel.enabled,
            priority: channel.priority ?? 100,
            keyExpiresAt: channel.keyExpiresAt?.slice(0, 10) || "",
        });
        setModalOpen(true);
    };

    const submit = async () => {
        const values = await form.validateFields();
        const payload: ChannelPayload = {
            name: values.name,
            baseUrl: values.baseUrl,
            apiFormat: values.apiFormat,
            models: (values.models ?? []).map((model, index) => ({ ...model, enabled: model.enabled !== false, sortOrder: Math.max(0, Math.floor(Number(model.sortOrder) || index)) })),
            enabled: values.enabled,
            priority: Math.max(0, Math.floor(Number(values.priority) || 0)),
            keyExpiresAt: values.keyExpiresAt || "",
            // 编辑时留空 = 保留原密钥；创建时必填由校验保证。
            ...(values.apiKey ? { apiKey: values.apiKey } : {}),
        };
        setSaving(true);
        try {
            if (editing) {
                await updateChannel(editing.id, payload);
                message.success("渠道已更新");
            } else {
                await createChannel(payload);
                message.success("渠道已创建");
            }
            setModalOpen(false);
            void load();
        } catch (error) {
            message.error(extractErrorMessage(error, "保存失败"));
        } finally {
            setSaving(false);
        }
    };

    const saveModelDefaults = async () => {
        setSavingDefaults(true);
        try {
            await updateModelDefaults({ defaults: modelDefaults, failoverEnabled, generationPricing: fallbackGenerationPricing });
            await syncBackendChannels();
            message.success("模型路由策略已更新");
        } catch (error) {
            message.error(extractErrorMessage(error, "默认模型保存失败"));
        } finally {
            setSavingDefaults(false);
        }
    };

    const selectPricingTarget = (value: string) => {
        const target = pricingTargets.find((item) => item.value === value);
        setPricingTarget(value);
        setVideoQualityDraft("");
        setGenerationPricing(pricingDraft(target, fallbackGenerationPricing));
    };

    const saveModelPricing = async () => {
        if (!selectedPricingTarget) {
            message.warning("请先选择图像或视频模型");
            return;
        }
        const completePricing = completeVideoPricingMatrix(generationPricing);
        setSavingPricing(true);
        try {
            await updateChannelModelPricing(selectedPricingTarget.channelId, selectedPricingTarget.modelName, completePricing);
            setGenerationPricing(completePricing);
            setChannels((current) =>
                current.map((channel) =>
                    channel.id === selectedPricingTarget.channelId
                        ? {
                              ...channel,
                              models: channel.models.map((model) => (model.name === selectedPricingTarget.modelName ? { ...model, generationPricing: completePricing } : model)),
                          }
                        : channel,
                ),
            );
            await syncBackendChannels();
            message.success(`「${selectedPricingTarget.modelName}」的独立积分表已保存`);
        } catch (error) {
            message.error(extractErrorMessage(error, "模型积分表保存失败"));
        } finally {
            setSavingPricing(false);
        }
    };

    const setImageQualityPoints = (key: string, value: number | null) => {
        setGenerationPricing((current) => ({
            ...current,
            imageQuality: { ...current.imageQuality, [key]: normalizePoints(value) },
        }));
    };

    const setVideoPoints = (quality: string, duration: string, value: number | null) => {
        setGenerationPricing((current) => ({
            ...current,
            videoPrices: {
                ...current.videoPrices,
                [quality]: { ...current.videoPrices[quality], [duration]: normalizePoints(value) },
            },
        }));
    };

    const addVideoQuality = () => {
        const quality = videoQualityDraft.trim().toLowerCase().replace(/p$/, "");
        if (!/^\d+$/.test(quality) || Number(quality) < 1) {
            message.warning("请输入有效分辨率，例如 480");
            return;
        }
        if (quality in generationPricing.videoPrices) {
            message.warning(`${quality}p 已存在`);
            return;
        }
        const durations = videoDurations(generationPricing);
        setGenerationPricing((current) => ({
            ...current,
            videoPrices: { ...current.videoPrices, [quality]: Object.fromEntries(durations.map((duration) => [duration, 0])) },
        }));
        setVideoQualityDraft("");
    };

    const removeVideoQuality = (quality: string) => {
        if (Object.keys(generationPricing.videoPrices).length <= 1) {
            message.warning("至少保留一个视频分辨率");
            return;
        }
        setGenerationPricing((current) => {
            const videoPrices = { ...current.videoPrices };
            delete videoPrices[quality];
            return { ...current, videoPrices };
        });
    };

    const toggle = async (channel: AdminChannel, enabled: boolean) => {
        try {
            await setChannelEnabled(channel.id, enabled);
            setChannels((prev) => prev.map((c) => (c.id === channel.id ? { ...c, enabled } : c)));
            if (!enabled) {
                setModelDefaults((current) => Object.fromEntries(Object.entries(current).map(([key, value]) => [key, value.startsWith(`${channel.id}::`) ? "" : value])) as ModelDefaults);
            }
        } catch (error) {
            message.error(extractErrorMessage(error, "切换状态失败"));
        }
    };

    const remove = (channel: AdminChannel) => {
        modal.confirm({
            title: `删除渠道「${channel.name}」？`,
            content: "删除后使用该渠道的模型将不可用，此操作不可撤销。",
            okType: "danger",
            okText: "删除",
            cancelText: "取消",
            onOk: async () => {
                try {
                    await deleteChannel(channel.id);
                    message.success("渠道已删除");
                    void load();
                } catch (error) {
                    message.error(extractErrorMessage(error, "删除失败"));
                }
            },
        });
    };

    return (
        <div>
            <header className="mb-6 flex items-center justify-between">
                <div>
                    <h1 className="text-xl font-semibold text-stone-950 dark:text-stone-100">渠道管理</h1>
                    <p className="mt-1 text-sm text-stone-500">配置第三方 AI 渠道，API Key 仅保存在服务端</p>
                </div>
                <Button type="primary" icon={<Plus className="size-4" />} onClick={openCreate}>
                    新增渠道
                </Button>
            </header>

            <section className="mb-5 rounded-lg border border-stone-200 bg-stone-50/70 p-4 dark:border-stone-800 dark:bg-stone-900/35">
                <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                    <div>
                        <div className="flex items-center gap-2 text-sm font-semibold text-stone-950 dark:text-stone-100">
                            <SlidersHorizontal className="size-4" />
                            模型路由策略
                        </div>
                        <p className="mt-1 text-xs leading-5 text-stone-500">统一维护默认模型与故障切换；备用渠道需要提供同名、同能力且相同接口格式的模型。</p>
                    </div>
                    <Button type="primary" icon={<Save className="size-4" />} loading={savingDefaults} onClick={() => void saveModelDefaults()}>
                        保存路由策略
                    </Button>
                </div>
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-md border border-stone-200 bg-white px-3 py-2.5 dark:border-stone-800 dark:bg-stone-950/70">
                    <div>
                        <div className="text-sm font-medium text-stone-800 dark:text-stone-200">自动故障切换</div>
                        <div className="mt-0.5 text-xs text-stone-400">连接失败、401/403、429 或 5xx 时，按渠道优先级尝试备用渠道；一次生成只扣一次积分。</div>
                    </div>
                    <Switch checked={failoverEnabled} onChange={setFailoverEnabled} checkedChildren="已开启" unCheckedChildren="已关闭" />
                </div>
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    {DEFAULT_MODEL_FIELDS.map((field) => (
                        <label key={field.key} className="block rounded-md border border-stone-200 bg-white p-3 dark:border-stone-800 dark:bg-stone-950/70">
                            <span className="block text-sm font-medium text-stone-800 dark:text-stone-200">{field.label}</span>
                            <span className="mb-2 mt-0.5 block text-xs text-stone-400">{field.description}</span>
                            <Select
                                className="w-full"
                                value={modelDefaults[field.key] || undefined}
                                options={defaultModelOptions[field.key]}
                                placeholder={defaultModelOptions[field.key].length ? "选择默认模型" : "暂无已上架模型"}
                                allowClear
                                onChange={(value) => setModelDefaults((current) => ({ ...current, [field.key]: value || "" }))}
                            />
                        </label>
                    ))}
                </div>
                <div className="my-4 border-t border-stone-200 dark:border-stone-800" />
                <div>
                    <div className="flex flex-wrap items-end justify-between gap-3">
                        <div>
                            <div className="text-sm font-semibold text-stone-900 dark:text-stone-100">模型独立生成参数积分</div>
                            <p className="mt-1 text-xs leading-5 text-stone-500">每个渠道中的每个图像/视频模型分别定价；同名模型也不会互相覆盖。</p>
                        </div>
                        <Button type="primary" icon={<Save className="size-4" />} loading={savingPricing} disabled={!selectedPricingTarget} onClick={() => void saveModelPricing()}>
                            保存当前模型积分
                        </Button>
                    </div>

                    <div className="mt-3 flex flex-col gap-3 rounded-md border border-stone-200 bg-white p-3 sm:flex-row sm:items-center dark:border-stone-800 dark:bg-stone-950/70">
                        <Select className="min-w-0 flex-1" value={pricingTarget || undefined} options={pricingTargets} placeholder="选择需要定价的图像或视频模型" showSearch optionFilterProp="label" onChange={selectPricingTarget} />
                        {selectedPricingTarget ? (
                            <div className="flex shrink-0 items-center gap-2">
                                <Tag color={selectedPricingTarget.capability === "image" ? "gold" : "blue"}>{selectedPricingTarget.capability === "image" ? "图像模型" : "视频模型"}</Tag>
                                <Tag color={selectedPricingTarget.generationPricing ? "green" : "default"}>{selectedPricingTarget.generationPricing ? "独立价格" : "继承旧全局价格"}</Tag>
                            </div>
                        ) : null}
                    </div>

                    {selectedPricingTarget?.capability === "image" ? (
                        <div className="mt-3 rounded-md border border-stone-200 bg-white p-3 dark:border-stone-800 dark:bg-stone-950/70">
                            <div className="flex flex-wrap items-end justify-between gap-2">
                                <div>
                                    <div className="text-sm font-medium text-stone-800 dark:text-stone-200">图片清晰度积分</div>
                                    <div className="mt-0.5 text-xs text-stone-400">最终积分 =（该模型基础积分 + 清晰度积分）× 生成张数。</div>
                                </div>
                                <Tag color="gold">积分 / 张</Tag>
                            </div>
                            <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                                {IMAGE_QUALITY_FIELDS.map((field) => (
                                    <label key={field.key} className="rounded-md bg-stone-50 px-3 py-2.5 dark:bg-stone-900/60">
                                        <span className="flex items-center justify-between gap-2 text-xs text-stone-600 dark:text-stone-300">
                                            <span className="font-medium">{field.label}</span>
                                            <span className="text-[11px] text-stone-400">{field.description}</span>
                                        </span>
                                        <InputNumber className="mt-2 w-full" min={0} max={1_000_000} precision={0} value={generationPricing.imageQuality[field.key] ?? 0} addonAfter="积分" onChange={(value) => setImageQualityPoints(field.key, value)} />
                                    </label>
                                ))}
                            </div>
                        </div>
                    ) : null}

                    {selectedPricingTarget?.capability === "video" ? (
                        <div className="mt-3 rounded-md border border-stone-200 bg-white p-3 dark:border-stone-800 dark:bg-stone-950/70">
                            <div className="flex flex-wrap items-end justify-between gap-3">
                                <div>
                                    <div className="text-sm font-medium text-stone-800 dark:text-stone-200">视频分辨率 × 时长积分表</div>
                                    <div className="mt-0.5 text-xs text-stone-400">最终积分 = 该模型基础积分 + 当前分辨率与 1–15 秒时长对应的参数积分。</div>
                                </div>
                                <Tag color="blue">每次视频的参数积分</Tag>
                            </div>
                            <div className="mt-3 flex max-w-xl gap-2">
                                <Input value={videoQualityDraft} placeholder="新增分辨率，如 1440" suffix="p" onChange={(event) => setVideoQualityDraft(event.target.value)} onPressEnter={addVideoQuality} />
                                <Button icon={<Plus className="size-3.5" />} onClick={addVideoQuality}>
                                    添加分辨率
                                </Button>
                            </div>
                            <div className="mt-3 overflow-x-auto rounded-md border border-stone-200 dark:border-stone-800">
                                <table className="w-full min-w-max border-collapse text-left text-xs">
                                    <thead className="bg-stone-50 text-stone-500 dark:bg-stone-900/80 dark:text-stone-400">
                                        <tr>
                                            <th className="sticky left-0 z-10 min-w-32 border-r border-stone-200 bg-stone-50 px-3 py-2.5 font-medium dark:border-stone-800 dark:bg-stone-900">视频时长</th>
                                            {sortVideoQualities(Object.keys(generationPricing.videoPrices)).map((quality) => (
                                                <th key={quality} className="min-w-44 border-r border-stone-200 px-3 py-2.5 font-medium last:border-r-0 dark:border-stone-800">
                                                    <div className="flex items-center justify-between gap-2">
                                                        <span>{quality}p</span>
                                                        <Button
                                                            type="text"
                                                            danger
                                                            size="small"
                                                            icon={<Trash2 className="size-3.5" />}
                                                            aria-label={`删除 ${quality}p`}
                                                            disabled={Object.keys(generationPricing.videoPrices).length <= 1}
                                                            onClick={() => removeVideoQuality(quality)}
                                                        />
                                                    </div>
                                                </th>
                                            ))}
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {videoDurations(generationPricing).map((duration) => (
                                            <tr key={duration} className="border-t border-stone-200 dark:border-stone-800">
                                                <th className="sticky left-0 z-10 border-r border-stone-200 bg-white px-3 py-2 font-medium text-stone-600 dark:border-stone-800 dark:bg-stone-950 dark:text-stone-300">{durationLabel(duration)}</th>
                                                {sortVideoQualities(Object.keys(generationPricing.videoPrices)).map((quality) => (
                                                    <td key={`${quality}:${duration}`} className="border-r border-stone-200 px-3 py-2 last:border-r-0 dark:border-stone-800">
                                                        <InputNumber
                                                            className="w-full"
                                                            min={0}
                                                            max={1_000_000}
                                                            precision={0}
                                                            value={generationPricing.videoPrices[quality]?.[duration] ?? 0}
                                                            addonAfter="积分"
                                                            onChange={(value) => setVideoPoints(quality, duration, value)}
                                                        />
                                                    </td>
                                                ))}
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    ) : null}
                </div>
            </section>

            <Table<AdminChannel>
                rowKey="id"
                loading={loading}
                dataSource={channels}
                pagination={false}
                columns={[
                    {
                        title: "名称",
                        dataIndex: "name",
                        render: (name: string, record) => (
                            <div>
                                <span>{name}</span>
                                {record.autoPaused ? (
                                    <Tooltip title={record.pausedReason}>
                                        <Tag color="red" className="ml-2">
                                            自动暂停
                                        </Tag>
                                    </Tooltip>
                                ) : null}
                            </div>
                        ),
                    },
                    { title: "Base URL", dataIndex: "baseUrl", ellipsis: true },
                    { title: "格式", dataIndex: "apiFormat", width: 110 },
                    {
                        title: "密钥有效期",
                        width: 125,
                        render: (_, record) => {
                            if (!record.keyExpiresAt) return <span className="text-xs text-stone-400">未设置</span>;
                            const remaining = new Date(record.keyExpiresAt).getTime() - Date.now();
                            const expired = remaining < 0;
                            const expiring = !expired && remaining < 7 * 24 * 60 * 60 * 1000;
                            return (
                                <Tooltip title={`最近轮换：${record.keyUpdatedAt ? new Date(record.keyUpdatedAt).toLocaleString("zh-CN") : "未知"}`}>
                                    <Tag color={expired ? "red" : expiring ? "orange" : "green"}>{expired ? "已过期" : expiring ? "即将过期" : new Date(record.keyExpiresAt).toLocaleDateString("zh-CN")}</Tag>
                                </Tooltip>
                            );
                        },
                    },
                    { title: "优先级", dataIndex: "priority", width: 90, sorter: (a, b) => a.priority - b.priority },
                    {
                        title: "模型",
                        dataIndex: "models",
                        render: (models: ChannelModel[]) => (
                            <Space size={[0, 4]} wrap>
                                {(models ?? []).map((m) => (
                                    <Tag key={m.name} className={m.enabled === false ? "opacity-50" : ""}>
                                        {m.name}
                                        <span className="ml-1 text-stone-400">{m.capability}</span>
                                        <span className="ml-1 text-amber-600 dark:text-amber-400">{Math.max(0, m.cost || 0)} 积分/次</span>
                                        {m.enabled === false ? <span className="ml-1 text-stone-400">已下架</span> : null}
                                    </Tag>
                                ))}
                            </Space>
                        ),
                    },
                    {
                        title: "启用",
                        dataIndex: "enabled",
                        width: 80,
                        render: (enabled: boolean, record) => <Switch checked={enabled} onChange={(next) => toggle(record, next)} size="small" />,
                    },
                    {
                        title: "操作",
                        width: 200,
                        render: (_, record) => (
                            <Space>
                                <Button size="small" loading={testingId === record.id} onClick={() => testSaved(record)}>
                                    测试
                                </Button>
                                <Button size="small" onClick={() => openEdit(record)}>
                                    编辑
                                </Button>
                                <Button size="small" danger onClick={() => remove(record)}>
                                    删除
                                </Button>
                            </Space>
                        ),
                    },
                ]}
            />

            <Modal
                title={editing ? "编辑渠道" : "新增渠道"}
                open={modalOpen}
                onCancel={() => setModalOpen(false)}
                onOk={submit}
                confirmLoading={saving}
                okText="保存"
                cancelText="取消"
                destroyOnHidden
                width={920}
                footer={[
                    <Button key="test" loading={draftTesting} onClick={testDraft}>
                        测试连接
                    </Button>,
                    <Button key="cancel" onClick={() => setModalOpen(false)}>
                        取消
                    </Button>,
                    <Button key="ok" type="primary" loading={saving} onClick={submit}>
                        保存
                    </Button>,
                ]}
            >
                <Form form={form} layout="vertical" className="mt-4">
                    <Form.Item name="name" label="名称" rules={[{ required: true, message: "请输入名称" }]}>
                        <Input placeholder="例如 OpenAI 官方" />
                    </Form.Item>
                    <Form.Item name="baseUrl" label="Base URL" rules={[{ required: true, message: "请输入 Base URL" }]}>
                        <Input placeholder="https://api.openai.com/v1" />
                    </Form.Item>
                    <Form.Item name="apiKey" label="API Key" extra={editing ? "留空表示保留原有密钥" : undefined} rules={editing ? [] : [{ required: true, message: "请输入 API Key" }]}>
                        <Input.Password placeholder={editing ? "••••••（留空不修改）" : "sk-..."} autoComplete="off" />
                    </Form.Item>
                    <Form.Item name="keyExpiresAt" label="API Key 到期日（可选）" extra="用于到期提醒；更换密钥后会自动更新最近轮换时间。">
                        <Input type="date" />
                    </Form.Item>
                    <div className="grid gap-4 sm:grid-cols-2">
                        <Form.Item name="apiFormat" label="接口格式" rules={[{ required: true }]}>
                            <Select options={API_FORMAT_OPTIONS} />
                        </Form.Item>
                        <Form.Item name="priority" label="渠道优先级" extra="数字越小越优先作为备用渠道" rules={[{ required: true }]}>
                            <InputNumber className="w-full" min={0} precision={0} />
                        </Form.Item>
                    </div>
                    <Form.List name="models">
                        {(fields, { add, remove: removeModel }) => (
                            <div className="flex flex-col gap-2">
                                <div className="flex items-center justify-between">
                                    <div>
                                        <div className="text-sm text-stone-600 dark:text-stone-300">模型与积分价格</div>
                                        <div className="mt-0.5 text-xs text-stone-400">普通用户只能使用这里启用的模型；积分在请求成功时结算，失败会自动退回。</div>
                                    </div>
                                    <Space>
                                        <Button size="small" loading={fetchingModels} onClick={fetchModels}>
                                            获取模型
                                        </Button>
                                        <Button size="small" onClick={() => add({ name: "", capability: "image", cost: 0, enabled: true, sortOrder: fields.length })}>
                                            添加模型
                                        </Button>
                                    </Space>
                                </div>
                                {fields.length ? (
                                    <div className="hidden grid-cols-[minmax(190px,1fr)_132px_108px_88px_72px_auto] gap-2 px-2 text-xs text-stone-400 md:grid">
                                        <span>模型名称</span>
                                        <span>能力</span>
                                        <span>积分/次</span>
                                        <span>排序</span>
                                        <span>上架</span>
                                        <span />
                                    </div>
                                ) : null}
                                {fields.map((field) => (
                                    <div
                                        key={field.key}
                                        className="grid grid-cols-1 gap-2 rounded-md border border-stone-200 bg-stone-50/60 p-2 md:grid-cols-[minmax(190px,1fr)_132px_108px_88px_72px_auto] md:items-start dark:border-stone-800 dark:bg-stone-900/30"
                                    >
                                        <Form.Item name={[field.name, "name"]} rules={[{ required: true, message: "模型名" }]} className="mb-0">
                                            <Input placeholder="模型名，例如 gpt-image-1" />
                                        </Form.Item>
                                        <Form.Item name={[field.name, "capability"]} rules={[{ required: true }]} className="mb-0">
                                            <Select options={CAPABILITY_OPTIONS} />
                                        </Form.Item>
                                        <Form.Item name={[field.name, "cost"]} className="mb-0" tooltip="调用一次消耗的积分，0 为免费">
                                            <InputNumber className="w-full" min={0} precision={0} placeholder="积分" />
                                        </Form.Item>
                                        <Form.Item name={[field.name, "sortOrder"]} className="mb-0">
                                            <InputNumber className="w-full" min={0} precision={0} placeholder="顺序" />
                                        </Form.Item>
                                        <Form.Item name={[field.name, "enabled"]} valuePropName="checked" className="mb-0 flex h-8 items-center">
                                            <Switch size="small" />
                                        </Form.Item>
                                        <Button size="small" type="text" danger onClick={() => removeModel(field.name)}>
                                            移除
                                        </Button>
                                    </div>
                                ))}
                            </div>
                        )}
                    </Form.List>
                    <Form.Item name="enabled" label="启用整个渠道" valuePropName="checked" className="mt-3 mb-0">
                        <Switch />
                    </Form.Item>
                </Form>
            </Modal>

            <Modal
                open={modelPicker !== null}
                title="选择要接入的模型"
                onCancel={() => setModelPicker(null)}
                onOk={applyPickedModels}
                okText={`添加 ${pickedModels.length} 个`}
                cancelText="取消"
                okButtonProps={{ disabled: pickedModels.length === 0 }}
                width={520}
                destroyOnHidden
            >
                <p className="mb-2 text-sm text-stone-500">从渠道拉取到 {modelPicker?.length ?? 0} 个可用模型，能力已按名称推断，可添加后再调整。</p>
                <Select mode="multiple" value={pickedModels} onChange={setPickedModels} style={{ width: "100%" }} placeholder="选择模型" options={(modelPicker ?? []).map((name) => ({ label: name, value: name }))} maxTagCount="responsive" />
                <div className="mt-2 flex gap-2">
                    <Button size="small" onClick={() => setPickedModels(modelPicker ?? [])}>
                        全选
                    </Button>
                    <Button size="small" onClick={() => setPickedModels([])}>
                        清空
                    </Button>
                </div>
            </Modal>
        </div>
    );
}
