import { useEffect, useState } from "react";
import { Alert, App, Button, Card, Form, Input, InputNumber, Select, Spin, Switch, Tag } from "antd";
import { CheckCircle2, Cloud, Database, KeyRound, Save, ShieldCheck, TestTube2, Trash2, XCircle } from "lucide-react";

import {
    fetchStorageSettings,
    fetchStorageCleanupStats,
    purgeExpiredStorageFiles,
    testStorageSettings,
    updateStorageSettings,
    type StorageProvider,
    type StorageSettings,
    type StorageCleanupStats,
} from "@/services/api/admin";
import { extractErrorMessage } from "@/utils/http-error";
import { formatBytes } from "@/lib/image-utils";

const providerOptions = [
    { label: "阿里云 OSS", value: "aliyun" },
    { label: "腾讯云 COS", value: "tencent" },
    { label: "AWS S3", value: "aws" },
    { label: "MinIO / S3 兼容", value: "minio" },
];

const providerHints: Record<StorageProvider, { endpoint: string; region: string; note: string }> = {
    aliyun: { endpoint: "oss-cn-hangzhou.aliyuncs.com", region: "cn-hangzhou", note: "使用 Bucket 所在地域的外网 Endpoint，无需填写 https://。" },
    tencent: { endpoint: "cos.ap-shanghai.myqcloud.com", region: "ap-shanghai", note: "Endpoint 不要包含 Bucket 名称，系统会自动按 S3 协议访问。" },
    aws: { endpoint: "s3.ap-southeast-1.amazonaws.com", region: "ap-southeast-1", note: "建议使用 Bucket 所在 Region 的区域 Endpoint。" },
    minio: { endpoint: "minio.example.com:9000", region: "us-east-1", note: "支持 MinIO、Cloudflare R2 等兼容 S3 签名的服务。" },
};

export default function AdminStoragePage() {
    const { message, modal } = App.useApp();
    const [form] = Form.useForm<StorageSettings>();
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [testing, setTesting] = useState(false);
    const [settings, setSettings] = useState<StorageSettings | null>(null);
    const [cleanupStats, setCleanupStats] = useState<StorageCleanupStats | null>(null);
    const [cleaning, setCleaning] = useState(false);
    const provider = Form.useWatch("provider", form) ?? "minio";
    const hint = providerHints[provider];

    useEffect(() => {
        let alive = true;
        Promise.all([fetchStorageSettings(), fetchStorageCleanupStats()])
            .then(([result, stats]) => {
                if (!alive) return;
                setSettings(result);
                setCleanupStats(stats);
                form.setFieldsValue({ ...result, accessKey: "", secretKey: "" });
            })
            .catch((error) => message.error(extractErrorMessage(error, "加载存储配置失败")))
            .finally(() => alive && setLoading(false));
        return () => {
            alive = false;
        };
    }, [form, message]);

    const applyResult = (result: StorageSettings) => {
        setSettings(result);
        form.setFieldsValue({ ...result, accessKey: "", secretKey: "" });
    };

    const save = async () => {
        const values = await form.validateFields();
        setSaving(true);
        try {
            const result = await updateStorageSettings({ ...settings, ...values } as StorageSettings);
            applyResult(result);
            message.success(result.enabled ? "对象存储配置已保存并即时生效" : "对象存储已关闭");
        } catch (error) {
            message.error(extractErrorMessage(error, "保存存储配置失败"));
        } finally {
            setSaving(false);
        }
    };

    const test = async () => {
        const values = await form.validateFields();
        if (!values.endpoint?.trim() || !values.bucket?.trim()) {
            message.warning("请先填写 Endpoint 和 Bucket");
            return;
        }
        if ((!settings?.accessKeyConfigured && !values.accessKey?.trim()) || (!settings?.secretKeyConfigured && !values.secretKey?.trim())) {
            message.warning("请先填写完整的 AccessKey ID 和 AccessKey Secret");
            return;
        }
        setTesting(true);
        try {
            const result = await testStorageSettings({ ...settings, ...values } as StorageSettings);
            message.success(result || "对象存储连接测试通过");
        } catch (error) {
            message.error(extractErrorMessage(error, "对象存储连接测试失败"));
        } finally {
            setTesting(false);
        }
    };

    const changeProvider = (next: StorageProvider) => {
        const nextHint = providerHints[next];
        form.setFieldsValue({ provider: next, endpoint: nextHint.endpoint, region: nextHint.region, useSSL: true });
    };

    const purgeExpired = () => {
        modal.confirm({
            title: "清理已过期的回收站文件？",
            content: `将永久删除 ${cleanupStats?.expiredFiles || 0} 个已超过保留期的 OSS 对象，此操作不可恢复。`,
            okText: "永久删除",
            okButtonProps: { danger: true },
            cancelText: "取消",
            onOk: async () => {
                setCleaning(true);
                try {
                    const result = await purgeExpiredStorageFiles();
                    message.success(`已清理 ${result.deletedFiles} 个文件，释放 ${formatBytes(result.deletedBytes)}`);
                    setCleanupStats(await fetchStorageCleanupStats());
                } catch (error) {
                    message.error(extractErrorMessage(error, "清理回收站失败"));
                } finally {
                    setCleaning(false);
                }
            },
        });
    };

    return (
        <div>
            <header className="mb-6 flex flex-wrap items-start justify-between gap-3">
                <div>
                    <div className="mb-2 inline-flex items-center gap-1.5 rounded-full bg-sky-50 px-2.5 py-1 text-xs font-medium text-sky-700 dark:bg-sky-950/40 dark:text-sky-300">
                        <Cloud className="size-3.5" />
                        媒体基础设施
                    </div>
                    <h1 className="text-xl font-semibold text-stone-950 dark:text-stone-100">存储配置</h1>
                    <p className="mt-1 text-sm text-stone-500">图片、视频和音频生成完成后直接写入 OSS，服务器不长期保存媒体文件</p>
                </div>
                <div className="flex gap-2">
                    <Button icon={<TestTube2 className="size-4" />} loading={testing} onClick={() => void test()}>
                        测试连接
                    </Button>
                    <Button type="primary" icon={<Save className="size-4" />} loading={saving} onClick={() => void save()}>
                        保存并生效
                    </Button>
                </div>
            </header>

            {loading ? (
                <div className="flex justify-center py-20"><Spin /></div>
            ) : (
                <div className="space-y-4">
                    <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_280px]">
                        <Alert
                            type="info"
                            showIcon
                            icon={<ShieldCheck className="size-4" />}
                            message="AccessKey ID 与 Secret 使用 AES-256-GCM 加密入库；后台接口只返回是否已配置，不会回显密钥。后端模式下 OSS 上传失败会直接提示用户，不再静默落到浏览器缓存。"
                        />
                        <Card size="small" styles={{ body: { height: "100%" } }}>
                            <div className="flex h-full items-center gap-3">
                                <span className={`grid size-9 place-items-center rounded-full ${settings?.available ? "bg-emerald-50 text-emerald-600 dark:bg-emerald-950/50" : "bg-stone-100 text-stone-500 dark:bg-stone-800"}`}>
                                    {settings?.available ? <CheckCircle2 className="size-5" /> : <XCircle className="size-5" />}
                                </span>
                                <div className="min-w-0">
                                    <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
                                        {settings?.available ? "存储服务可用" : settings?.enabled ? "存储连接异常" : "存储服务未启用"}
                                        <Tag color={settings?.source === "database" ? "blue" : "default"}>
                                            {settings?.source === "database" ? "后台配置" : "环境变量回退"}
                                        </Tag>
                                    </div>
                                    <p className="mt-1 truncate text-xs text-stone-500" title={settings?.statusMessage}>{settings?.statusMessage}</p>
                                </div>
                            </div>
                        </Card>
                    </div>

                    <Form form={form} layout="vertical" requiredMark={false}>
                        <Card
                            size="small"
                            title={<span className="inline-flex items-center gap-2"><Database className="size-4 text-sky-500" />对象存储连接</span>}
                            extra={<Form.Item name="enabled" valuePropName="checked" noStyle><Switch checkedChildren="已启用" unCheckedChildren="已关闭" /></Form.Item>}
                        >
                            <div className="grid gap-x-4 md:grid-cols-2 xl:grid-cols-4">
                                <Form.Item name="provider" label="服务商">
                                    <Select options={providerOptions} onChange={changeProvider} />
                                </Form.Item>
                                <Form.Item name="endpoint" label="Endpoint" dependencies={["enabled"]} rules={[requiredWhenEnabled("请输入 Endpoint")] } extra={hint.note} className="xl:col-span-2">
                                    <Input placeholder={hint.endpoint} autoComplete="off" />
                                </Form.Item>
                                <Form.Item name="region" label="Region" dependencies={["enabled"]} rules={[requiredWhenEnabled("请输入 Region")] }>
                                    <Input placeholder={hint.region} autoComplete="off" />
                                </Form.Item>
                            </div>

                            <div className="grid gap-x-4 md:grid-cols-2 xl:grid-cols-4">
                                <Form.Item name="bucket" label="Bucket" dependencies={["enabled"]} rules={[requiredWhenEnabled("请输入 Bucket 名称")] }>
                                    <Input placeholder="infinite-canvas" autoComplete="off" />
                                </Form.Item>
                                <Form.Item name="accessKey" label={<span className="inline-flex items-center gap-1.5"><KeyRound className="size-3.5" />AccessKey ID</span>} extra={settings?.accessKeyConfigured ? "已加密保存，留空保持不变。" : "启用存储时必须填写。"}>
                                    <Input.Password autoComplete="new-password" placeholder={settings?.accessKeyConfigured ? "已配置，留空保持不变" : "输入 AccessKey ID"} />
                                </Form.Item>
                                <Form.Item name="secretKey" label={<span className="inline-flex items-center gap-1.5"><KeyRound className="size-3.5" />AccessKey Secret</span>} extra={settings?.secretKeyConfigured ? "已加密保存，留空保持不变。" : "启用存储时必须填写。"}>
                                    <Input.Password autoComplete="new-password" placeholder={settings?.secretKeyConfigured ? "已配置，留空保持不变" : "输入 AccessKey Secret"} />
                                </Form.Item>
                                <Form.Item name="useSSL" label="HTTPS / SSL" valuePropName="checked" extra="生产环境建议始终启用。">
                                    <Switch checkedChildren="HTTPS" unCheckedChildren="HTTP" />
                                </Form.Item>
                            </div>
                        </Card>

                        <Card size="small" className="mt-4" title={<span className="inline-flex items-center gap-2"><Cloud className="size-4 text-emerald-500" />对象路径与下载</span>}>
                            <div className="grid gap-x-4 md:grid-cols-2">
                                <Form.Item name="imagePathPrefix" label="图片文件夹" extra="所有新生成图片、作品封面都会进入此目录。">
                                    <Input placeholder="image" />
                                </Form.Item>
                                <Form.Item name="videoPathPrefix" label="视频文件夹" extra="区分大小写；按你的 OSS 目录保留大写 V。">
                                    <Input placeholder="Video" />
                                </Form.Item>
                                <Form.Item name="pathPrefix" label="公共根目录（可选）" extra="留空时直接写入 image/ 与 Video/；填写 production 后会写入 production/image/。">
                                    <Input placeholder="留空" />
                                </Form.Item>
                                <Form.Item name="publicBaseUrl" label="下载入口前缀" extra="默认通过受鉴权的后端入口从 OSS 读取，避免公开 Bucket。">
                                    <Input placeholder="/api/files/" />
                                </Form.Item>
                                <Form.Item name="trashRetentionDays" label="回收站保留时间" extra="删除生成记录后先进入回收站，超过保留期才允许永久清理。">
                                    <InputNumber className="w-full" min={1} max={90} precision={0} addonAfter="天" />
                                </Form.Item>
                            </div>
                            <div className="rounded-lg border border-dashed border-stone-200 bg-stone-50/70 px-4 py-3 text-xs leading-5 text-stone-500 dark:border-stone-800 dark:bg-stone-900/50">
                                <span className="font-medium text-stone-700 dark:text-stone-300">生效流程：</span>
                                图片写入 <code className="mx-1 rounded bg-stone-200/70 px-1 py-0.5 text-stone-700 dark:bg-stone-800 dark:text-stone-300">image/</code>，视频写入 <code className="mx-1 rounded bg-stone-200/70 px-1 py-0.5 text-stone-700 dark:bg-stone-800 dark:text-stone-300">Video/</code>；数据库记录完整对象键，预览与下载按对象键从 OSS 读取。服务器仅处理流，不长期保存媒体文件。
                                <span className="mt-1 block text-amber-700 dark:text-amber-300">注意：切换 Endpoint 或 Bucket 不会自动迁移历史对象，请先迁移旧 Bucket 数据并保持对象键不变。</span>
                            </div>
                        </Card>
                    </Form>

                    <Card size="small" title={<span className="inline-flex items-center gap-2"><Trash2 className="size-4 text-rose-500" />媒体回收站</span>} extra={<Button danger size="small" icon={<Trash2 className="size-3.5" />} loading={cleaning} disabled={!cleanupStats?.expiredFiles} onClick={purgeExpired}>清理到期文件</Button>}>
                        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                            <StorageMetric label="正常文件" value={`${cleanupStats?.activeFiles || 0} 个`} detail={formatBytes(cleanupStats?.activeBytes || 0)} />
                            <StorageMetric label="回收站" value={`${cleanupStats?.trashedFiles || 0} 个`} detail={formatBytes(cleanupStats?.trashedBytes || 0)} />
                            <StorageMetric label="已到期" value={`${cleanupStats?.expiredFiles || 0} 个`} detail={`保留 ${settings?.trashRetentionDays || 7} 天`} warning={Boolean(cleanupStats?.expiredFiles)} />
                            <StorageMetric label="清理策略" value="仅显式删除" detail="不会猜测并误删画布引用" />
                        </div>
                    </Card>
                </div>
            )}
        </div>
    );
}

function StorageMetric({ label, value, detail, warning = false }: { label: string; value: string; detail: string; warning?: boolean }) {
    return (
        <div className="border-l-2 border-stone-200 pl-3 dark:border-stone-800">
            <div className="text-xs text-stone-500">{label}</div>
            <div className={`mt-1 text-lg font-semibold ${warning ? "text-rose-600 dark:text-rose-400" : "text-stone-900 dark:text-stone-100"}`}>{value}</div>
            <div className="mt-0.5 text-xs text-stone-400">{detail}</div>
        </div>
    );
}

function requiredWhenEnabled(message: string) {
    return ({ getFieldValue }: { getFieldValue: (name: string) => unknown }) => ({
        validator(_: unknown, value: unknown) {
            if (!getFieldValue("enabled") || (value !== undefined && value !== null && String(value).trim() !== "")) return Promise.resolve();
            return Promise.reject(new Error(message));
        },
    });
}
