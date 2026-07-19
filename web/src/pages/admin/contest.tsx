import { useCallback, useEffect, useState } from "react";
import { App, Button, Input, Modal, Segmented, Space, Table, Tag } from "antd";
import { Star } from "lucide-react";

import { featureContestEntry, fetchAdminContest, fetchAdminContestBlob, reviewContestEntry, type AdminContestEntry, type AdminContestStatus } from "@/services/api/admin";
import { extractErrorMessage } from "@/utils/http-error";

const STATUS_TAG: Record<AdminContestStatus, { label: string; color: string }> = {
    pending: { label: "待审核", color: "gold" },
    approved: { label: "已通过", color: "green" },
    rejected: { label: "已拒绝", color: "red" },
};

// AdminContestPage：管理员审核作品并维护首页推荐。
export default function AdminContestPage() {
    const { message, modal } = App.useApp();
    const [filter, setFilter] = useState<AdminContestStatus | "all">("pending");
    const [items, setItems] = useState<AdminContestEntry[]>([]);
    const [loading, setLoading] = useState(true);
    const [preview, setPreview] = useState<{ entry: AdminContestEntry; url: string | null } | null>(null);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            setItems(await fetchAdminContest(filter));
        } catch (error) {
            message.error(extractErrorMessage(error, "加载作品失败"));
        } finally {
            setLoading(false);
        }
    }, [filter, message]);

    useEffect(() => {
        let alive = true;
        void fetchAdminContest(filter)
            .then((entries) => alive && setItems(entries))
            .catch((error) => alive && message.error(extractErrorMessage(error, "加载作品失败")))
            .finally(() => alive && setLoading(false));
        return () => {
            alive = false;
        };
    }, [filter, message]);

    // 预览：拉取带鉴权的视频 blob 转 objectURL，关闭时释放。
    const openPreview = async (entry: AdminContestEntry) => {
        setPreview((current) => {
            if (current?.url) URL.revokeObjectURL(current.url);
            return { entry, url: null };
        });
        try {
            const url = await fetchAdminContestBlob(entry.id, "media");
            setPreview((current) => {
                if (current?.entry.id === entry.id) return { entry, url };
                URL.revokeObjectURL(url);
                return current;
            });
        } catch (error) {
            message.error(extractErrorMessage(error, "视频加载失败"));
        }
    };

    const closePreview = () => {
        setPreview((current) => {
            if (current?.url) URL.revokeObjectURL(current.url);
            return null;
        });
    };

    const review = async (entry: AdminContestEntry, action: "approve" | "reject") => {
        const run = async (note?: string) => {
            try {
                await reviewContestEntry(entry.id, action, note);
                message.success(action === "approve" ? "已通过，作品将出现在广场" : "已拒绝");
                await load();
            } catch (error) {
                message.error(extractErrorMessage(error, "操作失败"));
            }
        };
        if (action === "approve") {
            void run();
            return;
        }
        let note = "";
        modal.confirm({
            title: `拒绝作品「${entry.title}」？`,
            content: <Input.TextArea placeholder="拒绝原因（可选，会记录在案）" maxLength={500} autoSize={{ minRows: 2, maxRows: 4 }} onChange={(e) => (note = e.target.value)} />,
            okType: "danger",
            okText: "拒绝",
            cancelText: "取消",
            onOk: () => run(note.trim()),
        });
    };

    const toggleFeatured = async (entry: AdminContestEntry) => {
        try {
            await featureContestEntry(entry.id, !entry.featured);
            setItems((current) => current.map((item) => (item.id === entry.id ? { ...item, featured: !item.featured } : item)));
            message.success(entry.featured ? "已取消首页推荐" : "已加入首页推荐");
        } catch (error) {
            message.error(extractErrorMessage(error, "推荐位更新失败"));
        }
    };

    return (
        <div>
            <header className="mb-6">
                <h1 className="text-xl font-semibold text-stone-950 dark:text-stone-100">大赛审核</h1>
                <p className="mt-1 text-sm text-stone-500">通过的作品会进入公开广场，可按需设置为首页推荐。</p>
            </header>

            <Segmented
                value={filter}
                onChange={(v) => {
                    setLoading(true);
                    setFilter(v as AdminContestStatus | "all");
                }}
                className="mb-4"
                options={[
                    { label: "待审核", value: "pending" },
                    { label: "已通过", value: "approved" },
                    { label: "已拒绝", value: "rejected" },
                    { label: "全部", value: "all" },
                ]}
            />

            <Table<AdminContestEntry>
                rowKey="id"
                loading={loading}
                dataSource={items}
                pagination={{ pageSize: 20, hideOnSinglePage: true }}
                columns={[
                    {
                        title: "作品",
                        render: (_, e) => (
                            <div>
                                <div className="font-medium text-stone-950 dark:text-stone-100">{e.title}</div>
                                <div className="text-xs text-stone-400">
                                    {e.authorName} · {e.authorEmail}
                                </div>
                            </div>
                        ),
                    },
                    {
                        title: "配方",
                        dataIndex: "recipeType",
                        width: 90,
                        render: (t: string) => (t === "skill" ? <Tag color="gold">Skill</Tag> : <Tag color="blue">提示词</Tag>),
                    },
                    { title: "点赞", dataIndex: "likes", width: 70, align: "right", render: (n: number) => <span className="tabular-nums">{n}</span> },
                    {
                        title: "状态",
                        dataIndex: "status",
                        width: 100,
                        render: (s: AdminContestStatus, e) => (
                            <div className="space-y-1">
                                <Tag color={STATUS_TAG[s].color}>{STATUS_TAG[s].label}</Tag>
                                {e.featured ? <Tag color="gold">首页推荐</Tag> : null}
                            </div>
                        ),
                    },
                    {
                        title: "提交时间",
                        dataIndex: "createdAt",
                        width: 160,
                        render: (t: string) => <span className="text-xs text-stone-500">{new Date(t).toLocaleString("zh-CN")}</span>,
                    },
                    {
                        title: "操作",
                        width: 250,
                        render: (_, e) => (
                            <Space wrap>
                                <Button size="small" onClick={() => void openPreview(e)}>
                                    预览
                                </Button>
                                {e.status !== "approved" ? (
                                    <Button size="small" type="primary" onClick={() => void review(e, "approve")}>
                                        通过
                                    </Button>
                                ) : null}
                                {e.status !== "rejected" ? (
                                    <Button size="small" danger onClick={() => void review(e, "reject")}>
                                        拒绝
                                    </Button>
                                ) : null}
                                <Button size="small" icon={<Star className="size-3.5" />} disabled={e.status !== "approved"} onClick={() => void toggleFeatured(e)}>
                                    {e.featured ? "取消推荐" : "首页推荐"}
                                </Button>
                            </Space>
                        ),
                    },
                ]}
                expandable={{
                    expandedRowRender: (e) => (
                        <div className="space-y-2">
                            {e.description ? <p className="text-sm text-stone-600 dark:text-stone-300">{e.description}</p> : null}
                            {e.reviewNote ? <p className="text-xs text-rose-500">审核备注：{e.reviewNote}</p> : null}
                            <pre className="max-h-60 overflow-auto whitespace-pre-wrap break-words rounded-md border border-stone-200 bg-stone-50 p-3 font-mono text-xs leading-5 text-stone-700 dark:border-stone-800 dark:bg-stone-950 dark:text-stone-200">
                                {e.recipeContent}
                            </pre>
                        </div>
                    ),
                }}
            />

            <Modal open={preview !== null} title={preview?.entry.title} onCancel={closePreview} footer={null} width={720} destroyOnClose>
                <div className="aspect-video overflow-hidden rounded-lg bg-black">
                    {preview?.url ? <video src={preview.url} controls autoPlay playsInline className="size-full object-contain" /> : <div className="grid size-full place-items-center text-sm text-stone-400">加载中…</div>}
                </div>
            </Modal>
        </div>
    );
}
