import { useEffect, useState } from "react";
import { App, Button, Form, Input, Modal, Select, Space, Switch, Table, Tag } from "antd";
import { Plus } from "lucide-react";

import { createUser, deleteUser, listUsers, revokeUserSessions, setUserDisabled, setUserRole, type AdminUser, type CreateUserPayload } from "@/services/api/admin";
import { useAuthStore } from "@/stores/use-auth-store";
import { extractErrorMessage } from "@/utils/http-error";
import UserMediaModal from "./user-media-modal";

export default function AdminUsersPage() {
    const { message, modal } = App.useApp();
    const selfId = useAuthStore((state) => state.user?.id);
    const [users, setUsers] = useState<AdminUser[]>([]);
    const [loading, setLoading] = useState(true);
    const [mediaTarget, setMediaTarget] = useState<AdminUser | null>(null);
    const [createOpen, setCreateOpen] = useState(false);
    const [createSaving, setCreateSaving] = useState(false);
    const [createForm] = Form.useForm<CreateUserPayload>();

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

    const patch = (id: string, next: Partial<AdminUser>) => setUsers((current) => current.map((user) => (user.id === id ? { ...user, ...next } : user)));

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

    const toggleDisabled = async (user: AdminUser, disabled: boolean) => {
        try {
            await setUserDisabled(user.id, disabled);
            patch(user.id, { disabled });
        } catch (error) {
            message.error(extractErrorMessage(error, "修改状态失败"));
        }
    };

    const confirmRevokeSessions = (user: AdminUser) => {
        modal.confirm({
            title: `使 ${user.displayName || user.email} 的所有会话失效？`,
            content: "该用户在所有设备上都需要重新登录。",
            okText: "确认下线",
            cancelText: "取消",
            onOk: async () => {
                await revokeUserSessions(user.id);
                message.success("该用户的所有会话已失效");
            },
        });
    };

    const submitCreate = async () => {
        const values = await createForm.validateFields();
        setCreateSaving(true);
        try {
            const user = await createUser(values);
            setUsers((current) => [user, ...current]);
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
            content: "该用户的画布、资产和媒体数据将一并永久删除，无法恢复。",
            okType: "danger",
            okText: "删除",
            cancelText: "取消",
            onOk: async () => {
                await deleteUser(user.id);
                setUsers((current) => current.filter((item) => item.id !== user.id));
                message.success("用户已删除");
            },
        });
    };

    return (
        <div>
            <header className="mb-6 flex items-start justify-between gap-4">
                <div>
                    <h1 className="text-xl font-semibold text-stone-950 dark:text-stone-100">用户管理</h1>
                    <p className="mt-1 text-sm text-stone-500">管理账号、角色、登录状态和用户媒体</p>
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
                scroll={{ x: 820 }}
                columns={[
                    {
                        title: "用户",
                        render: (_, user) => (
                            <div>
                                <div className="font-medium text-stone-950 dark:text-stone-100">
                                    {user.displayName || user.email}
                                    {user.id === selfId ? <Tag className="ml-2">我</Tag> : null}
                                    <Tag color={user.emailVerified ? "green" : "orange"} className="ml-2">
                                        {user.emailVerified ? "邮箱已验证" : "待验证"}
                                    </Tag>
                                </div>
                                <div className="text-xs text-stone-400">{user.email}</div>
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
                                onChange={(value) => void changeRole(user, value)}
                            />
                        ),
                    },
                    {
                        title: "状态",
                        dataIndex: "disabled",
                        width: 110,
                        render: (disabled: boolean, user) => <Switch size="small" checked={!disabled} disabled={user.id === selfId} checkedChildren="启用" unCheckedChildren="禁用" onChange={(enabled) => void toggleDisabled(user, !enabled)} />,
                    },
                    { title: "创建时间", dataIndex: "createdAt", width: 170, render: (value: string) => <span className="text-xs text-stone-500">{new Date(value).toLocaleString("zh-CN")}</span> },
                    {
                        title: "操作",
                        width: 250,
                        render: (_, user) => (
                            <Space wrap>
                                <Button size="small" onClick={() => setMediaTarget(user)}>
                                    媒体
                                </Button>
                                <Button size="small" disabled={user.id === selfId} onClick={() => confirmRevokeSessions(user)}>
                                    下线
                                </Button>
                                <Button size="small" danger disabled={user.id === selfId} onClick={() => confirmDelete(user)}>
                                    删除
                                </Button>
                            </Space>
                        ),
                    },
                ]}
            />

            <UserMediaModal user={mediaTarget} onClose={() => setMediaTarget(null)} />
            <Modal open={createOpen} title="新建用户" onCancel={() => setCreateOpen(false)} onOk={() => void submitCreate()} confirmLoading={createSaving} okText="创建" cancelText="取消" destroyOnHidden>
                <Form form={createForm} layout="vertical" className="mt-4" initialValues={{ role: "user" }}>
                    <Form.Item name="email" label="邮箱" rules={[{ required: true, type: "email", message: "请输入有效邮箱" }]}>
                        <Input autoComplete="off" />
                    </Form.Item>
                    <Form.Item name="displayName" label="显示名称">
                        <Input maxLength={80} />
                    </Form.Item>
                    <Form.Item name="password" label="初始密码" rules={[{ required: true, min: 8, message: "至少 8 位" }]}>
                        <Input.Password autoComplete="new-password" />
                    </Form.Item>
                    <Form.Item name="role" label="角色">
                        <Select options={[{ label: "普通用户", value: "user" }, { label: "运营管理员", value: "operator" }, { label: "超级管理员", value: "admin" }]} />
                    </Form.Item>
                </Form>
            </Modal>
        </div>
    );
}
