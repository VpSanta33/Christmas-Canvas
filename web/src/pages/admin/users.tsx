import { useEffect, useState } from "react";
import { App, Button, Form, Input, InputNumber, Modal, Select, Space, Switch, Table, Tag } from "antd";
import { Plus } from "lucide-react";

import { createUser, deleteUser, fetchUserLedger, listUsers, revokeUserSessions, setUserDisabled, setUserQuota, setUserRole, topupUserCredits, type AdminUser, type CreateUserPayload, type LedgerItem } from "@/services/api/admin";
import { useAuthStore } from "@/stores/use-auth-store";
import { extractErrorMessage } from "@/utils/http-error";
import UserMediaModal from "./user-media-modal";

const LEDGER_REASON_LABELS: Record<string, string> = {
    signup_bonus: "注册赠送",
    register: "注册赠送",
    admin_topup: "管理员充值",
    ai_usage: "AI 调用",
    consume: "AI 调用",
    contest_award: "大赛奖励结算",
};

export default function AdminUsersPage() {
    const { message, modal } = App.useApp();
    const selfId = useAuthStore((state) => state.user?.id);
    const [users, setUsers] = useState<AdminUser[]>([]);
    const [loading, setLoading] = useState(true);
    const [topupTarget, setTopupTarget] = useState<AdminUser | null>(null);
    const [topupAmount, setTopupAmount] = useState<number | null>(100);
    const [topupSaving, setTopupSaving] = useState(false);
    const [ledgerTarget, setLedgerTarget] = useState<AdminUser | null>(null);
    const [ledger, setLedger] = useState<LedgerItem[]>([]);
    const [ledgerLoading, setLedgerLoading] = useState(false);
    const [mediaTarget, setMediaTarget] = useState<AdminUser | null>(null);
    const [createOpen, setCreateOpen] = useState(false);
    const [createSaving, setCreateSaving] = useState(false);
    const [createForm] = Form.useForm<CreateUserPayload>();

    const openLedger = async (user: AdminUser) => {
        setLedgerTarget(user);
        setLedger([]);
        setLedgerLoading(true);
        try {
            setLedger(await fetchUserLedger(user.id));
        } catch (error) {
            message.error(extractErrorMessage(error, "加载流水失败"));
        } finally {
            setLedgerLoading(false);
        }
    };

    useEffect(() => {
        let alive = true;
        void listUsers()
            .then((items) => alive && setUsers(items))
            .catch((error) => alive && message.error(extractErrorMessage(error, "加载用户失败")))
            .finally(() => alive && setLoading(false));
        return () => {
            alive = false;
        };
    }, [message]);

    const patch = (id: string, next: Partial<AdminUser>) => setUsers((prev) => prev.map((u) => (u.id === id ? { ...u, ...next } : u)));

    const changeRole = async (user: AdminUser, role: "user" | "operator" | "admin") => {
        if (role === user.role) return;
        try {
            await setUserRole(user.id, role);
            patch(user.id, { role });
            message.success("用户角色已更新，旧会话已失效");
        } catch (error) {
            message.error(extractErrorMessage(error, "修改角色失败"));
        }
    };

    const confirmRevokeSessions = (user: AdminUser) => {
        modal.confirm({
            title: `使 ${user.displayName || user.email} 的所有会话失效？`,
            content: "该用户在所有设备上的 access token 和 refresh token 都会立即失效，需要重新登录。",
            okText: "确认下线",
            cancelText: "取消",
            onOk: async () => {
                await revokeUserSessions(user.id);
                message.success("该用户的所有会话已失效");
            },
        });
    };

    const toggleDisabled = async (user: AdminUser, disabled: boolean) => {
        try {
            await setUserDisabled(user.id, disabled);
            patch(user.id, { disabled });
        } catch (error) {
            message.error(extractErrorMessage(error, "修改状态失败"));
        }
    };

    const saveQuota = async (user: AdminUser, dailyLimit: number) => {
        if (dailyLimit === user.dailyLimit) return;
        try {
            await setUserQuota(user.id, dailyLimit);
            patch(user.id, { dailyLimit });
            message.success("配额已更新");
        } catch (error) {
            message.error(extractErrorMessage(error, "修改配额失败"));
        }
    };

    const submitTopup = async () => {
        if (!topupTarget || !topupAmount || topupAmount <= 0) return;
        setTopupSaving(true);
        try {
            const credits = await topupUserCredits(topupTarget.id, topupAmount);
            patch(topupTarget.id, { credits });
            message.success(`已为 ${topupTarget.displayName || topupTarget.email} 充值 ${topupAmount} 积分`);
            setTopupTarget(null);
        } catch (error) {
            message.error(extractErrorMessage(error, "充值失败"));
        } finally {
            setTopupSaving(false);
        }
    };

    const submitCreate = async () => {
        const values = await createForm.validateFields();
        setCreateSaving(true);
        try {
            const user = await createUser(values);
            setUsers((prev) => [user, ...prev]);
            message.success(`已创建用户 ${user.displayName || user.email}`);
            setCreateOpen(false);
            createForm.resetFields();
        } catch (error) {
            message.error(extractErrorMessage(error, "创建用户失败"));
        } finally {
            setCreateSaving(false);
        }
    };

    const confirmDelete = (user: AdminUser) => {
        modal.confirm({
            title: `删除用户 ${user.displayName || user.email}？`,
            content: "该用户的画布、资产、生成的媒体、用量与积分流水将一并永久删除，无法恢复。",
            okType: "danger",
            okText: "删除",
            cancelText: "取消",
            onOk: async () => {
                try {
                    await deleteUser(user.id);
                    setUsers((prev) => prev.filter((u) => u.id !== user.id));
                    message.success("用户已删除");
                } catch (error) {
                    message.error(extractErrorMessage(error, "删除用户失败"));
                    throw error;
                }
            },
        });
    };

    return (
        <div>
            <header className="mb-6 flex items-start justify-between">
                <div>
                    <h1 className="text-xl font-semibold text-stone-950 dark:text-stone-100">用户管理</h1>
                    <p className="mt-1 text-sm text-stone-500">管理角色、积分余额、每日配额与账号启用状态</p>
                </div>
                <Button type="primary" icon={<Plus size={16} />} onClick={() => setCreateOpen(true)}>
                    新建用户
                </Button>
            </header>

            <Table<AdminUser>
                rowKey="id"
                loading={loading}
                dataSource={users}
                pagination={false}
                columns={[
                    {
                        title: "用户",
                        render: (_, u) => (
                            <div>
                                <div className="font-medium text-stone-950 dark:text-stone-100">
                                    {u.displayName || u.email}
                                    {u.id === selfId ? <Tag className="ml-2">我</Tag> : null}
                                    <Tag color={u.emailVerified ? "green" : "orange"} className="ml-2">
                                        {u.emailVerified ? "邮箱已验证" : "待验证"}
                                    </Tag>
                                </div>
                                <div className="text-xs text-stone-400">{u.email}</div>
                            </div>
                        ),
                    },
                    {
                        title: "角色",
                        dataIndex: "role",
                        width: 145,
                        render: (role: string, user) => (
                            <Select
                                size="small"
                                value={role as "user" | "operator" | "admin"}
                                disabled={user.id === selfId}
                                className="w-32"
                                options={[
                                    { label: "普通用户", value: "user" },
                                    { label: "运营管理员", value: "operator" },
                                    { label: "超级管理员", value: "admin" },
                                ]}
                                onChange={(value: "user" | "operator" | "admin") => void changeRole(user, value)}
                            />
                        ),
                    },
                    {
                        title: "积分余额",
                        dataIndex: "credits",
                        width: 120,
                        render: (credits: number) => (
                            <span
                                className={
                                    "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-sm font-bold tabular-nums " +
                                    (credits > 0 ? "bg-gradient-to-r from-amber-100 to-yellow-200 text-amber-800 ring-1 ring-amber-300" : "bg-stone-100 text-stone-400 ring-1 ring-stone-200")
                                }
                            >
                                {credits} 积分
                            </span>
                        ),
                    },
                    {
                        title: "今日用量 / 配额",
                        width: 200,
                        render: (_, u) => (
                            <Space>
                                <span className="text-stone-500">{u.usedToday} /</span>
                                <InputNumber min={0} defaultValue={u.dailyLimit} size="small" style={{ width: 90 }} onBlur={(e) => saveQuota(u, Number(e.target.value))} onPressEnter={(e) => saveQuota(u, Number((e.target as HTMLInputElement).value))} />
                            </Space>
                        ),
                    },
                    {
                        title: "启用",
                        width: 80,
                        render: (_, u) => <Switch size="small" checked={!u.disabled} disabled={u.id === selfId} onChange={(on) => toggleDisabled(u, !on)} />,
                    },
                    {
                        title: "操作",
                        width: 390,
                        render: (_, u) => (
                            <Space wrap>
                                <Button
                                    size="small"
                                    onClick={() => {
                                        setTopupTarget(u);
                                        setTopupAmount(100);
                                    }}
                                >
                                    充值
                                </Button>
                                <Button size="small" onClick={() => openLedger(u)}>
                                    流水
                                </Button>
                                <Button size="small" onClick={() => setMediaTarget(u)}>
                                    查看内容
                                </Button>
                                <Button size="small" disabled={u.id === selfId} onClick={() => confirmRevokeSessions(u)}>
                                    下线会话
                                </Button>
                                <Button size="small" danger disabled={u.id === selfId} onClick={() => confirmDelete(u)}>
                                    删除
                                </Button>
                            </Space>
                        ),
                    },
                ]}
            />

            <Modal
                open={topupTarget !== null}
                title={`充值积分 · ${topupTarget?.displayName || topupTarget?.email || ""}`}
                onCancel={() => setTopupTarget(null)}
                onOk={submitTopup}
                confirmLoading={topupSaving}
                okButtonProps={{ disabled: !topupAmount || topupAmount <= 0 }}
                okText="确认充值"
                cancelText="取消"
                destroyOnClose
            >
                <div className="space-y-2">
                    <p className="text-sm text-stone-500">
                        当前余额：<span className="tabular-nums">{topupTarget?.credits ?? 0}</span> 积分
                    </p>
                    <InputNumber min={1} value={topupAmount} onChange={setTopupAmount} style={{ width: "100%" }} addonAfter="积分" autoFocus />
                </div>
            </Modal>

            <Modal open={ledgerTarget !== null} title={`积分流水 · ${ledgerTarget?.displayName || ledgerTarget?.email || ""}`} onCancel={() => setLedgerTarget(null)} footer={null} width={560} destroyOnClose>
                <Table<LedgerItem>
                    rowKey={(row) => `${row.createdAt}-${row.reason}-${row.delta}`}
                    size="small"
                    loading={ledgerLoading}
                    dataSource={ledger}
                    pagination={{ pageSize: 10, hideOnSinglePage: true }}
                    columns={[
                        {
                            title: "时间",
                            dataIndex: "createdAt",
                            width: 170,
                            render: (t: string) => <span className="text-xs text-stone-500">{new Date(t).toLocaleString("zh-CN")}</span>,
                        },
                        {
                            title: "类型",
                            dataIndex: "reason",
                            render: (reason: string, row) => LEDGER_REASON_LABELS[reason] ?? (row.model ? `${reason} · ${row.model}` : reason),
                        },
                        {
                            title: "变动",
                            dataIndex: "delta",
                            width: 90,
                            align: "right",
                            render: (delta: number) => <span className={`tabular-nums font-medium ${delta >= 0 ? "text-emerald-600" : "text-red-500"}`}>{delta >= 0 ? `+${delta}` : delta}</span>,
                        },
                        {
                            title: "余额",
                            dataIndex: "balanceAfter",
                            width: 80,
                            align: "right",
                            render: (balance: number) => <span className="tabular-nums">{balance}</span>,
                        },
                    ]}
                />
            </Modal>

            <Modal open={createOpen} title="新建用户" onCancel={() => setCreateOpen(false)} onOk={submitCreate} confirmLoading={createSaving} okText="创建" cancelText="取消" destroyOnClose>
                <Form form={createForm} layout="vertical" className="mt-4" initialValues={{ role: "user", credits: 0 }}>
                    <Form.Item name="email" label="邮箱" rules={[{ required: true, type: "email", message: "请输入合法邮箱" }]}>
                        <Input placeholder="user@example.com" autoComplete="off" />
                    </Form.Item>
                    <Form.Item name="password" label="密码" rules={[{ required: true, min: 8, max: 72, message: "密码长度需为 8-72 位" }]}>
                        <Input.Password placeholder="8-72 位" autoComplete="new-password" />
                    </Form.Item>
                    <Form.Item name="displayName" label="昵称（可选）">
                        <Input placeholder="留空则取邮箱前缀" />
                    </Form.Item>
                    <Space size="large" className="flex">
                        <Form.Item name="role" label="角色">
                            <Select
                                style={{ width: 140 }}
                                options={[
                                    { label: "用户", value: "user" },
                                    { label: "运营管理员", value: "operator" },
                                    { label: "超级管理员", value: "admin" },
                                ]}
                            />
                        </Form.Item>
                        <Form.Item name="credits" label="初始积分">
                            <InputNumber min={0} style={{ width: 140 }} />
                        </Form.Item>
                    </Space>
                </Form>
            </Modal>

            <UserMediaModal user={mediaTarget} onClose={() => setMediaTarget(null)} />
        </div>
    );
}
