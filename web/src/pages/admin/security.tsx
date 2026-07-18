import { useCallback, useEffect, useState } from "react";
import { App, Button, Input, Table, Tag, Tooltip } from "antd";
import { RefreshCw, Search, ShieldCheck } from "lucide-react";

import { fetchAuditLogs, type AuditLog } from "@/services/api/admin";
import { extractErrorMessage } from "@/utils/http-error";

export default function AdminSecurityPage() {
    const { message } = App.useApp();
    const [items, setItems] = useState<AuditLog[]>([]);
    const [query, setQuery] = useState("");
    const [loading, setLoading] = useState(true);
    const load = useCallback(async () => {
        setLoading(true);
        try {
            setItems(await fetchAuditLogs(query.trim(), 300));
        } catch (error) {
            message.error(extractErrorMessage(error, "加载审计日志失败"));
        } finally {
            setLoading(false);
        }
    }, [message, query]);
    useEffect(() => {
        let alive = true;
        void fetchAuditLogs("", 300)
            .then((next) => alive && setItems(next))
            .catch((error) => message.error(extractErrorMessage(error, "加载审计日志失败")))
            .finally(() => alive && setLoading(false));
        return () => {
            alive = false;
        };
    }, [message]);
    return (
        <div>
            <header className="mb-6 flex flex-wrap items-start justify-between gap-3">
                <div>
                    <h1 className="flex items-center gap-2 text-xl font-semibold text-stone-950 dark:text-stone-100">
                        <ShieldCheck className="size-5" />
                        后台安全与审计
                    </h1>
                    <p className="mt-1 text-sm text-stone-500">记录管理员写操作；请求正文、密码、提示词和 API Key 不进入审计日志</p>
                </div>
                <Button icon={<RefreshCw className="size-4" />} loading={loading} onClick={() => void load()}>
                    刷新
                </Button>
            </header>
            <div className="mb-3 flex max-w-lg gap-2">
                <Input allowClear prefix={<Search className="size-4 text-stone-400" />} value={query} placeholder="管理员、操作、目标或请求 ID" onChange={(event) => setQuery(event.target.value)} onPressEnter={() => void load()} />
                <Button onClick={() => void load()}>查询</Button>
            </div>
            <Table<AuditLog>
                rowKey="id"
                size="small"
                loading={loading}
                dataSource={items}
                scroll={{ x: 1080 }}
                pagination={{ pageSize: 30, showSizeChanger: false }}
                columns={[
                    { title: "时间", dataIndex: "createdAt", width: 170, render: (value: string) => new Date(value).toLocaleString("zh-CN") },
                    {
                        title: "管理员",
                        width: 210,
                        render: (_, row) => (
                            <div>
                                <div>{row.actorEmail || "已删除账号"}</div>
                                <Tag className="mt-1">{row.actorRole === "admin" ? "超级管理员" : "运营管理员"}</Tag>
                            </div>
                        ),
                    },
                    { title: "操作", dataIndex: "action", width: 260, render: (value: string) => <code className="text-xs">{value}</code> },
                    { title: "目标", dataIndex: "target", width: 190, ellipsis: true },
                    { title: "结果", dataIndex: "httpStatus", width: 80, render: (value: number) => <Tag color={value >= 200 && value < 300 ? "green" : "red"}>{value}</Tag> },
                    { title: "来源 IP", dataIndex: "ipAddress", width: 145 },
                    {
                        title: "请求 ID",
                        dataIndex: "requestId",
                        width: 170,
                        render: (value: string) => (
                            <Tooltip title={value}>
                                <span className="block truncate text-xs text-stone-500">{value}</span>
                            </Tooltip>
                        ),
                    },
                ]}
            />
        </div>
    );
}
