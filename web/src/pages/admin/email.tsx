import { useEffect, useState } from "react";
import { Alert, App, Button, Card, Form, Input, InputNumber, Select, Spin, Switch, Tag } from "antd";
import { KeyRound, Mail, Save, Send, ShieldCheck } from "lucide-react";

import { fetchEmailSettings, testEmailSettings, updateEmailSettings, type EmailSettings } from "@/services/api/admin";
import { syncPlatformSettings } from "@/services/api/platform";
import { extractErrorMessage } from "@/utils/http-error";

export default function AdminEmailPage() {
    const { message } = App.useApp();
    const [form] = Form.useForm<EmailSettings>();
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [testing, setTesting] = useState(false);
    const [testEmail, setTestEmail] = useState("");
    const [passwordConfigured, setPasswordConfigured] = useState(false);

    useEffect(() => {
        let alive = true;
        fetchEmailSettings()
            .then((settings) => {
                if (!alive) return;
                form.setFieldsValue(settings);
                setPasswordConfigured(settings.passwordConfigured);
            })
            .catch((error) => message.error(extractErrorMessage(error, "加载邮箱服务失败")))
            .finally(() => alive && setLoading(false));
        return () => {
            alive = false;
        };
    }, [form, message]);

    const save = async (showSuccess = true) => {
        const values = await form.validateFields();
        setSaving(true);
        try {
            await updateEmailSettings(values);
            setPasswordConfigured((configured) => configured || Boolean(values.password));
            form.setFieldValue("password", "");
            await syncPlatformSettings();
            if (showSuccess) message.success("邮箱服务设置已保存");
            return true;
        } catch (error) {
            message.error(extractErrorMessage(error, "保存邮箱服务失败"));
            return false;
        } finally {
            setSaving(false);
        }
    };

    const sendTest = async () => {
        const recipient = testEmail.trim();
        if (!recipient) {
            message.warning("请输入接收测试邮件的邮箱");
            return;
        }
        setTesting(true);
        try {
            if (!(await save(false))) return;
            await testEmailSettings(recipient);
            message.success("测试邮件已发送，请检查收件箱");
        } catch (error) {
            message.error(extractErrorMessage(error, "测试邮件发送失败"));
        } finally {
            setTesting(false);
        }
    };

    return (
        <div>
            <header className="mb-6 flex flex-wrap items-start justify-between gap-3">
                <div>
                    <div className="mb-2 inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
                        <Mail className="size-3.5" />
                        注册安全基础设施
                    </div>
                    <h1 className="text-xl font-semibold text-stone-950 dark:text-stone-100">邮箱服务</h1>
                    <p className="mt-1 text-sm text-stone-500">配置 SMTP 发信与新用户邮箱验证</p>
                </div>
                <Button type="primary" icon={<Save className="size-4" />} loading={saving} onClick={() => void save()}>
                    保存邮箱设置
                </Button>
            </header>

            {loading ? (
                <div className="flex justify-center py-20">
                    <Spin />
                </div>
            ) : (
                <div className="space-y-4">
                    <Alert type="info" showIcon icon={<ShieldCheck className="size-4" />} title="SMTP 密码使用 AES-256-GCM 加密保存，管理接口不会返回密码明文。启用验证后，新用户通过验证码后才会创建正式账号。" />

                    <Form form={form} layout="vertical" requiredMark={false}>
                        <Card
                            size="small"
                            title={
                                <span className="inline-flex items-center gap-2">
                                    <Mail className="size-4 text-emerald-500" />
                                    SMTP 连接
                                </span>
                            }
                            extra={<Tag color={passwordConfigured ? "green" : "default"}>{passwordConfigured ? "密码已加密保存" : "未配置密码"}</Tag>}
                        >
                            <div className="grid gap-x-4 md:grid-cols-2 xl:grid-cols-4">
                                <Form.Item name="enabled" label="注册邮箱验证" valuePropName="checked" extra="关闭后注册流程不会发送验证码。">
                                    <Switch checkedChildren="已启用" unCheckedChildren="已关闭" />
                                </Form.Item>
                                <Form.Item name="host" label="SMTP 主机" dependencies={["enabled"]} rules={[requiredWhenEnabled("请输入 SMTP 主机")]}>
                                    <Input placeholder="smtp.example.com" />
                                </Form.Item>
                                <Form.Item name="port" label="端口" dependencies={["enabled"]} rules={[requiredWhenEnabled("请输入 SMTP 端口")]}>
                                    <InputNumber className="w-full" min={1} max={65535} precision={0} />
                                </Form.Item>
                                <Form.Item name="mode" label="连接加密" dependencies={["enabled"]} rules={[requiredWhenEnabled("请选择连接加密方式")]}>
                                    <Select
                                        options={[
                                            { label: "STARTTLS（推荐）", value: "starttls" },
                                            { label: "TLS / SSL", value: "tls" },
                                            { label: "不加密（仅本地测试）", value: "none" },
                                        ]}
                                    />
                                </Form.Item>
                            </div>

                            <div className="grid gap-x-4 md:grid-cols-2">
                                <Form.Item name="username" label="SMTP 用户名">
                                    <Input autoComplete="off" placeholder="通常为完整邮箱地址" />
                                </Form.Item>
                                <Form.Item
                                    name="password"
                                    label={
                                        <span className="inline-flex items-center gap-1.5">
                                            <KeyRound className="size-3.5" />
                                            SMTP 密码 / 授权码
                                        </span>
                                    }
                                    extra={passwordConfigured ? "留空将保留当前加密密码。" : "部分本地 SMTP 服务无需密码。"}
                                >
                                    <Input.Password autoComplete="new-password" placeholder={passwordConfigured ? "已配置，留空保持不变" : "输入密码或邮箱授权码"} />
                                </Form.Item>
                            </div>

                            <div className="grid gap-x-4 md:grid-cols-2">
                                <Form.Item name="fromEmail" label="发件邮箱" dependencies={["enabled"]} rules={[requiredWhenEnabled("请输入发件邮箱"), { type: "email", message: "请输入有效发件邮箱" }]}>
                                    <Input placeholder="no-reply@example.com" />
                                </Form.Item>
                                <Form.Item name="fromName" label="发件人名称" dependencies={["enabled"]} rules={[requiredWhenEnabled("请输入发件人名称")]}>
                                    <Input placeholder="圣诞画布" maxLength={80} />
                                </Form.Item>
                            </div>
                        </Card>
                    </Form>

                    <Card size="small" title="发送测试邮件">
                        <p className="mb-3 text-xs leading-5 text-stone-500">会先保存上方配置，再使用已保存的 SMTP 连接发送一封测试邮件。</p>
                        <div className="flex flex-col gap-2 sm:flex-row">
                            <Input value={testEmail} onChange={(event) => setTestEmail(event.target.value)} placeholder="admin@example.com" onPressEnter={() => void sendTest()} />
                            <Button icon={<Send className="size-4" />} loading={testing} onClick={() => void sendTest()}>
                                保存并发送测试邮件
                            </Button>
                        </div>
                    </Card>
                </div>
            )}
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
