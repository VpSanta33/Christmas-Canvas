import { useEffect, useState } from "react";
import { App, Card, Spin } from "antd";

import { fetchOverview, type AdminOverview } from "@/services/api/admin";
import { extractErrorMessage } from "@/utils/http-error";

type Stat = { label: string; value: number | string; hint?: string };

export default function AdminOverviewPage() {
    const { message } = App.useApp();
    const [data, setData] = useState<AdminOverview | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let alive = true;
        fetchOverview()
            .then((res) => {
                if (alive) setData(res);
            })
            .catch((error) => message.error(extractErrorMessage(error, "加载概览失败")))
            .finally(() => {
                if (alive) setLoading(false);
            });
        return () => {
            alive = false;
        };
    }, [message]);

    const stats: Stat[] = data
        ? [
              { label: "用户总数", value: data.users.total, hint: `${data.users.disabled} 已禁用` },
              { label: "渠道总数", value: data.channels.total, hint: `${data.channels.enabled} 已启用` },
              { label: "今日 AI 调用", value: data.usage.today },
              { label: "今日成功率", value: `${data.usage.successRate.toFixed(1)}%`, hint: `${data.usage.errorsToday} 次异常` },
              { label: "近 7 日调用", value: data.usage.last7Days },
              { label: "近 7 日积分消费", value: data.credits.consumedLast7Days },
              { label: "媒体存储", value: formatBytes(data.storage.bytes), hint: `${data.storage.files} 个文件` },
              { label: "待审核作品", value: data.content.contestPending, hint: `${data.content.contestApproved} 件已通过` },
          ]
        : [];

    return (
        <div>
            <header className="mb-6">
                <h1 className="text-xl font-semibold text-stone-950 dark:text-stone-100">系统概览</h1>
                <p className="mt-1 text-sm text-stone-500">用户、渠道与 AI 调用量一览</p>
            </header>
            {loading ? (
                <div className="flex justify-center py-20">
                    <Spin />
                </div>
            ) : (
                <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                    {stats.map((stat) => (
                        <Card key={stat.label} size="small">
                            <div className="text-sm text-stone-500">{stat.label}</div>
                            <div className="mt-2 text-2xl font-semibold text-stone-950 dark:text-stone-100">{typeof stat.value === "number" ? stat.value.toLocaleString() : stat.value}</div>
                            {stat.hint ? <div className="mt-1 text-xs text-stone-400">{stat.hint}</div> : null}
                        </Card>
                    ))}
                </div>
            )}
        </div>
    );
}

function formatBytes(value: number) {
    if (value < 1024) return `${value} B`;
    if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`;
    if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(1)} MB`;
    return `${(value / 1024 ** 3).toFixed(1)} GB`;
}
