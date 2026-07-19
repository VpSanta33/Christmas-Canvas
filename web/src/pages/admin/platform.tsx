import { useEffect, useState } from "react";
import { App, Button, Card, Form, Input, Spin, Switch } from "antd";
import { Save, Settings2, UserPlus } from "lucide-react";

import { fetchPlatformSettings, updatePlatformSettings, type PlatformSettings } from "@/services/api/admin";
import { syncPlatformSettings } from "@/services/api/platform";
import { extractErrorMessage } from "@/utils/http-error";

export default function AdminPlatformPage() {
    const { message } = App.useApp();
    const [form] = Form.useForm<PlatformSettings>();
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        let alive = true;
        fetchPlatformSettings()
            .then((settings) => {
                if (alive) form.setFieldsValue(settings);
            })
            .catch((error) => message.error(extractErrorMessage(error, "加载站点设置失败")))
            .finally(() => alive && setLoading(false));
        return () => {
            alive = false;
        };
    }, [form, message]);

    const save = async () => {
        const values = await form.validateFields();
        setSaving(true);
        try {
            await updatePlatformSettings(values);
            await syncPlatformSettings();
            message.success("站点设置已生效");
        } catch (error) {
            message.error(extractErrorMessage(error, "保存站点设置失败"));
        } finally {
            setSaving(false);
        }
    };

    return (
        <div>
            <header className="mb-6 flex flex-wrap items-start justify-between gap-3">
                <div>
                    <div className="mb-2 inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
                        <Settings2 className="size-3.5" />
                        站点基础配置
                    </div>
                    <h1 className="text-xl font-semibold text-stone-950 dark:text-stone-100">站点设置</h1>
                    <p className="mt-1 text-sm text-stone-500">管理品牌信息和用户注册策略</p>
                </div>
                <Button type="primary" icon={<Save className="size-4" />} loading={saving} onClick={() => void save()}>
                    保存设置
                </Button>
            </header>

            {loading ? (
                <div className="flex justify-center py-20">
                    <Spin />
                </div>
            ) : (
                <Form form={form} layout="vertical" requiredMark={false} className="grid gap-4 lg:grid-cols-2">
                    <Card
                        size="small"
                        title={
                            <span className="inline-flex items-center gap-2">
                                <Settings2 className="size-4 text-amber-500" />
                                品牌信息
                            </span>
                        }
                    >
                        <Form.Item name="siteName" label="网站名称" rules={[{ required: true, message: "请输入网站名称" }]}>
                            <Input maxLength={80} placeholder="显示在导航栏和登录页" />
                        </Form.Item>
                        <Form.Item name="logoUrl" label="Logo 地址" rules={[{ required: true, message: "请输入 Logo 地址" }]} extra="支持站内路径或公开图片地址。">
                            <Input placeholder="/logo.svg" />
                        </Form.Item>
                    </Card>

                    <Card
                        size="small"
                        title={
                            <span className="inline-flex items-center gap-2">
                                <UserPlus className="size-4 text-emerald-500" />
                                注册策略
                            </span>
                        }
                    >
                        <Form.Item name="allowRegistration" label="开放注册" valuePropName="checked" extra="关闭后仅管理员可以创建账号。">
                            <Switch checkedChildren="开放" unCheckedChildren="关闭" />
                        </Form.Item>
                    </Card>
                </Form>
            )}
        </div>
    );
}
