import { useEffect, useState } from "react";
import { App, Card, Segmented, Spin } from "antd";

import { fetchUsageStats, type AdminUsage } from "@/services/api/admin";
import { extractErrorMessage } from "@/utils/http-error";

const CAP_LABELS: Record<string, string> = {
    image: "图像",
    video: "视频",
    audio: "音频",
    text: "文本",
};

export default function AdminUsagePage() {
    const { message } = App.useApp();
    const [days, setDays] = useState(14);
    const [data, setData] = useState<AdminUsage | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let alive = true;
        setLoading(true);
        fetchUsageStats(days)
            .then((res) => {
                if (alive) setData(res);
            })
            .catch((error) => message.error(extractErrorMessage(error, "加载用量失败")))
            .finally(() => {
                if (alive) setLoading(false);
            });
        return () => {
            alive = false;
        };
    }, [days, message]);

    const maxDaily = Math.max(1, ...(data?.daily.map((d) => d.count) ?? [1]));
    const totalCap = data?.byCapability.reduce((sum, c) => sum + c.count, 0) ?? 0;
    const totalChannel = data?.byChannel.reduce((sum, c) => sum + c.count, 0) ?? 0;

    return (
        <div>
            <header className="mb-6 flex items-center justify-between">
                <div>
                    <h1 className="text-xl font-semibold text-stone-950 dark:text-stone-100">用量统计</h1>
                    <p className="mt-1 text-sm text-stone-500">AI 调用趋势与能力分布</p>
                </div>
                <Segmented
                    value={days}
                    onChange={(value) => setDays(Number(value))}
                    options={[
                        { label: "7 天", value: 7 },
                        { label: "14 天", value: 14 },
                        { label: "30 天", value: 30 },
                    ]}
                />
            </header>

            {loading ? (
                <div className="flex justify-center py-20">
                    <Spin />
                </div>
            ) : (
                <div className="grid gap-4 lg:grid-cols-3">
                    <Card size="small" title="每日调用趋势" className="lg:col-span-2">
                        <div className="flex h-56 items-end gap-1">
                            {data?.daily.map((point) => (
                                <div key={point.date} className="group flex flex-1 flex-col items-center justify-end">
                                    <div
                                        className="w-full rounded-t bg-stone-800 transition group-hover:bg-stone-950 dark:bg-stone-500 dark:group-hover:bg-stone-300"
                                        style={{ height: `${(point.count / maxDaily) * 100}%`, minHeight: point.count ? 2 : 0 }}
                                        title={`${point.date}: ${point.count}`}
                                    />
                                </div>
                            ))}
                        </div>
                        <div className="mt-2 flex justify-between text-xs text-stone-400">
                            <span>{data?.daily[0]?.date}</span>
                            <span>{data?.daily[data.daily.length - 1]?.date}</span>
                        </div>
                    </Card>

                    <Card size="small" title="按能力分布">
                        {totalCap === 0 ? (
                            <div className="py-8 text-center text-sm text-stone-400">暂无数据</div>
                        ) : (
                            <div className="flex flex-col gap-3">
                                {data?.byCapability.map((cap) => (
                                    <div key={cap.capability}>
                                        <div className="mb-1 flex justify-between text-sm">
                                            <span className="text-stone-700 dark:text-stone-200">
                                                {CAP_LABELS[cap.capability] ?? cap.capability}
                                            </span>
                                            <span className="text-stone-400">{cap.count}</span>
                                        </div>
                                        <div className="h-2 rounded bg-stone-100 dark:bg-stone-800">
                                            <div
                                                className="h-2 rounded bg-stone-800 dark:bg-stone-400"
                                                style={{ width: `${(cap.count / totalCap) * 100}%` }}
                                            />
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </Card>

                    <Card size="small" title="按渠道分布" className="lg:col-span-3">
                        {totalChannel === 0 ? (
                            <div className="py-8 text-center text-sm text-stone-400">暂无数据</div>
                        ) : (
                            <div className="flex flex-col gap-3">
                                {data?.byChannel.map((ch) => (
                                    <div key={ch.channelId || ch.name}>
                                        <div className="mb-1 flex justify-between text-sm">
                                            <span className="text-stone-700 dark:text-stone-200">{ch.name}</span>
                                            <span className="text-stone-400">{ch.count}</span>
                                        </div>
                                        <div className="h-2 rounded bg-stone-100 dark:bg-stone-800">
                                            <div
                                                className="h-2 rounded bg-amber-500/80"
                                                style={{ width: `${(ch.count / totalChannel) * 100}%` }}
                                            />
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </Card>
                </div>
            )}
        </div>
    );
}
