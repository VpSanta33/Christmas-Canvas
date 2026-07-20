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
              { label: "媒体存储", value: formatBytes(data.storage.bytes), hint: `${data.storage.files} 个文件` },
          ]
        : [];

    return (
        <div>
            <header className="mb-6">
                <h1 className="text-xl font-semibold text-stone-950 dark:text-stone-100">系统概览</h1>
                <p className="mt-1 text-sm text-stone-500">用户与媒体存储概览</p>
            </header>
            {loading ? (
                <div className="flex justify-center py-20">
                    <Spin />
                </div>
            ) : (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
