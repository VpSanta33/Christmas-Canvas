import { useCallback, useEffect, useMemo, useState } from "react";
import { App, Button, Card, Input, Select, Table, Tag, Tooltip } from "antd";
import { AlertTriangle, CheckCircle2, Copy, RefreshCw, Search, ShieldAlert } from "lucide-react";

import { fetchCallLogs, fetchChannelHealth, type CallLog, type ChannelHealthSummary } from "@/services/api/admin";
import { extractErrorMessage } from "@/utils/http-error";

const STATUS_LABELS: Record<string, { label: string; color?: string }> = {
    ok: { label: "成功", color: "green" },
    error: { label: "上游失败", color: "red" },
    timeout: { label: "超时", color: "orange" },
    cancelled: { label: "用户取消" },
    rejected: { label: "请求拒绝", color: "gold" },
};

export default function AdminObservabilityPage() {
    const { message } = App.useApp();
    const [logs, setLogs] = useState<CallLog[]>([]);
    const [health, setHealth] = useState<ChannelHealthSummary[]>([]);
    const [loading, setLoading] = useState(true);
    const [query, setQuery] = useState("");
    const [status, setStatus] = useState("");

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const [nextLogs, nextHealth] = await Promise.all([fetchCallLogs({ q: query.trim(), status: status || undefined, limit: 200 }), fetchChannelHealth()]);
            setLogs(nextLogs);
            setHealth(nextHealth);
        } catch (error) {
            message.error(extractErrorMessage(error, "加载调用日志失败"));
        } finally {
            setLoading(false);
        }
    }, [message, query, status]);

    useEffect(() => {
        let alive = true;
        void Promise.all([fetchCallLogs({ limit: 200 }), fetchChannelHealth()])
            .then(([nextLogs, nextHealth]) => {
                if (!alive) return;
                setLogs(nextLogs);
                setHealth(nextHealth);
            })
            .catch((error) => message.error(extractErrorMessage(error, "加载调用日志失败")))
            .finally(() => alive && setLoading(false));
        return () => {
            alive = false;
        };
    }, [message]);

    const alerts = useMemo(() => health.filter((item) => item.severity !== "healthy"), [health]);

    const copyRequestID = async (value: string) => {
        await navigator.clipboard.writeText(value);
        message.success("请求 ID 已复制");
    };

    return (
        <div>
            <header className="mb-6 flex flex-wrap items-start justify-between gap-3">
                <div>
                    <h1 className="text-xl font-semibold text-stone-950 dark:text-stone-100">调用日志与渠道健康</h1>
                    <p className="mt-1 text-sm text-stone-500">按请求 ID 排查调用链，监控渠道成功率、延迟、退款与自动暂停</p>
                </div>
                <Button icon={<RefreshCw className="size-4" />} loading={loading} onClick={() => void load()}>
                    刷新
                </Button>
            </header>

            <div className="mb-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {health.map((item) => {
                    const Icon = item.severity === "critical" ? ShieldAlert : item.severity === "warning" ? AlertTriangle : CheckCircle2;
                    return (
                        <Card key={item.channelId} size="small" className={item.severity === "critical" ? "border-rose-300 dark:border-rose-500/40" : item.severity === "warning" ? "border-amber-300 dark:border-amber-500/40" : ""}>
                            <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                    <div className="flex items-center gap-2 font-medium text-stone-900 dark:text-stone-100">
                                        <Icon className="size-4" />
                                        {item.name}
                                    </div>
                                    <div className="mt-1 text-xs text-stone-400">24 小时 {item.calls24h} 次调用</div>
                                </div>
                                <Tag color={item.severity === "critical" ? "red" : item.severity === "warning" ? "orange" : "green"}>{item.autoPaused ? "自动暂停" : item.enabled ? "运行中" : "已停用"}</Tag>
                            </div>
                            <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                                <Metric label="成功率" value={`${item.successRate.toFixed(1)}%`} />
                                <Metric label="平均耗时" value={`${item.averageLatencyMs}ms`} />
                                <Metric label="退款积分" value={String(item.refundedCredits)} />
                            </div>
                            {item.pausedReason || item.lastError ? (
                                <Tooltip title={item.lastError}>
                                    <div className="mt-3 truncate rounded bg-stone-50 px-2 py-1.5 text-xs text-stone-500 dark:bg-stone-900">{item.pausedReason || item.lastError}</div>
                                </Tooltip>
                            ) : null}
                        </Card>
                    );
                })}
            </div>

            {alerts.length ? (
                <div className="mb-4 flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-200">
                    <AlertTriangle className="size-4" />
                    当前有 {alerts.length} 个渠道需要关注；自动暂停的渠道需在“渠道管理”中确认后重新启用。
                </div>
            ) : null}

            <div className="mb-3 flex flex-wrap gap-2">
                <Input allowClear className="max-w-sm" prefix={<Search className="size-4 text-stone-400" />} value={query} placeholder="请求 ID、用户邮箱、渠道或模型" onChange={(event) => setQuery(event.target.value)} onPressEnter={() => void load()} />
                <Select className="w-36" value={status} onChange={setStatus} options={[{ value: "", label: "全部结果" }, ...Object.entries(STATUS_LABELS).map(([value, item]) => ({ value, label: item.label }))]} />
                <Button onClick={() => void load()}>查询</Button>
            </div>

            <Table<CallLog>
                rowKey="id"
                size="small"
                loading={loading}
                dataSource={logs}
                scroll={{ x: 1120 }}
                pagination={{ pageSize: 25, showSizeChanger: false }}
                expandable={{
                    expandedRowRender: (record) => (
                        <div className="space-y-2 px-2 py-1 text-xs">
                            <div>
                                <span className="text-stone-400">请求 ID：</span>
                                {record.requestId || "—"}
                            </div>
                            <div>
                                <span className="text-stone-400">错误详情：</span>
                                {record.errorMessage || "无"}
                            </div>
                            <div className="text-stone-400">日志仅保存排障元数据，不保存提示词、附件或 API Key。</div>
                        </div>
                    ),
                }}
                columns={[
                    { title: "时间", dataIndex: "createdAt", width: 168, render: (value: string) => new Date(value).toLocaleString("zh-CN") },
                    { title: "结果", dataIndex: "status", width: 105, render: (value: string) => <Tag color={STATUS_LABELS[value]?.color}>{STATUS_LABELS[value]?.label || value}</Tag> },
                    { title: "用户", dataIndex: "userEmail", width: 190, ellipsis: true },
                    {
                        title: "渠道 / 模型",
                        width: 240,
                        render: (_, row) => (
                            <div>
                                <div>{row.channelName || "已删除渠道"}</div>
                                <div className="truncate text-xs text-stone-400">{row.model || "—"}</div>
                            </div>
                        ),
                    },
                    { title: "HTTP", dataIndex: "httpStatus", width: 75, render: (value: number) => value || "—" },
                    { title: "耗时", dataIndex: "latencyMs", width: 90, render: (value: number) => `${value}ms` },
                    { title: "积分", width: 90, render: (_, row) => (row.refunded ? <span className="text-amber-600">{row.credits} 已退</span> : row.credits) },
                    {
                        title: "请求 ID",
                        dataIndex: "requestId",
                        width: 175,
                        render: (value: string) =>
                            value ? (
                                <button className="inline-flex max-w-40 items-center gap-1 truncate text-xs text-stone-500 hover:text-stone-950 dark:hover:text-white" onClick={() => void copyRequestID(value)}>
                                    <span className="truncate">{value}</span>
                                    <Copy className="size-3 shrink-0" />
                                </button>
                            ) : (
                                "—"
                            ),
                    },
                ]}
            />
        </div>
    );
}

function Metric({ label, value }: { label: string; value: string }) {
    return (
        <div className="rounded bg-stone-50 px-2 py-2 dark:bg-stone-900">
            <div className="text-sm font-semibold tabular-nums text-stone-900 dark:text-stone-100">{value}</div>
            <div className="mt-0.5 text-[11px] text-stone-400">{label}</div>
        </div>
    );
}
