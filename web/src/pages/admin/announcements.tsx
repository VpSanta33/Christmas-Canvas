import { useEffect, useState } from "react";
import { Alert, App, Button, Card, Form, Input, Spin, Switch } from "antd";
import { Megaphone, Save, Wrench } from "lucide-react";

import { fetchAnnouncementSettings, updateAnnouncementSettings, type AnnouncementSettings } from "@/services/api/admin";
import { syncPlatformSettings } from "@/services/api/platform";
import { extractErrorMessage } from "@/utils/http-error";

export default function AdminAnnouncementsPage() {
    const { message } = App.useApp();
    const [form] = Form.useForm<AnnouncementSettings>();
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        let alive = true;
        fetchAnnouncementSettings()
            .then((settings) => {
                if (alive) form.setFieldsValue(settings);
            })
            .catch((error) => message.error(extractErrorMessage(error, "加载公告设置失败")))
            .finally(() => alive && setLoading(false));
        return () => {
            alive = false;
        };
    }, [form, message]);

    const save = async () => {
        const values = await form.validateFields();
        setSaving(true);
        try {
            await updateAnnouncementSettings(values);
            await syncPlatformSettings();
            message.success("公告已更新，用户端将立即显示最新内容");
        } catch (error) {
            message.error(extractErrorMessage(error, "保存公告失败"));
        } finally {
            setSaving(false);
        }
    };

    return (
        <div>
            <header className="mb-6 flex flex-wrap items-start justify-between gap-3">
                <div>
                    <div className="mb-2 inline-flex items-center gap-1.5 rounded-full bg-sky-50 px-2.5 py-1 text-xs font-medium text-sky-700 dark:bg-sky-950/40 dark:text-sky-300">
                        <Megaphone className="size-3.5" />
                        用户端消息
                    </div>
                    <h1 className="text-xl font-semibold text-stone-950 dark:text-stone-100">公告管理</h1>
                    <p className="mt-1 text-sm text-stone-500">分别维护日常公告与高优先级维护通知</p>
                </div>
                <Button type="primary" icon={<Save className="size-4" />} loading={saving} onClick={() => void save()}>
                    发布更新
                </Button>
            </header>

            {loading ? (
                <div className="flex justify-center py-20">
                    <Spin />
                </div>
            ) : (
                <Form form={form} layout="vertical" requiredMark={false} className="space-y-4">
                    <Card
                        size="small"
                        title={
                            <span className="inline-flex items-center gap-2">
                                <Megaphone className="size-4 text-sky-500" />
                                普通公告
                            </span>
                        }
                    >
                        <Form.Item name="announcement" extra="显示在用户端顶栏下方；留空并保存即可隐藏。" className="mb-0">
                            <Input.TextArea rows={4} maxLength={2000} showCount placeholder="例如：新的视频模型已经上线，欢迎前往视频创作台体验。" />
                        </Form.Item>
                    </Card>

                    <Card
                        size="small"
                        title={
                            <span className="inline-flex items-center gap-2">
                                <Wrench className="size-4 text-amber-500" />
                                维护通知
                            </span>
                        }
                    >
                        <Alert type="warning" showIcon message="维护通知的优先级高于普通公告，建议仅在服务异常或计划维护时开启。" className="mb-4" />
                        <div className="grid items-start gap-x-6 lg:grid-cols-[180px_minmax(0,1fr)]">
                            <Form.Item name="maintenanceEnabled" label="通知状态" valuePropName="checked">
                                <Switch checkedChildren="正在显示" unCheckedChildren="已隐藏" />
                            </Form.Item>
                            <Form.Item name="maintenanceNotice" label="维护说明" extra="建议写明受影响功能与预计恢复时间。" className="mb-0">
                                <Input.TextArea rows={4} maxLength={2000} showCount placeholder="例如：视频生成服务将在今晚 23:00–23:30 维护。" />
                            </Form.Item>
                        </div>
                    </Card>
                </Form>
            )}
        </div>
    );
}
