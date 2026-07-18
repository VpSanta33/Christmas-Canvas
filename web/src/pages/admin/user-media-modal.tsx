import { useEffect, useState } from "react";
import { App, Empty, Modal, Segmented, Spin, Table, Tag } from "antd";

import {
    fetchUserMedia,
    fetchUserMediaBlob,
    fetchUserUsageRecords,
    type AdminUser,
    type UsageRecord,
    type UserMediaItem,
} from "@/services/api/admin";
import { extractErrorMessage } from "@/utils/http-error";

const CAP_LABELS: Record<string, string> = {
    image: "图片",
    video: "视频",
    audio: "音频",
    text: "文本",
};

// MediaThumb 惰性拉取带鉴权的媒体 blob 并预览图片/视频。
function MediaThumb({ userId, item }: { userId: string; item: UserMediaItem }) {
    const { message } = App.useApp();
    const [url, setUrl] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let objectUrl: string | null = null;
        let alive = true;
        fetchUserMediaBlob(userId, item.storageKey)
            .then((u) => {
                if (!alive) {
                    URL.revokeObjectURL(u);
                    return;
                }
                objectUrl = u;
                setUrl(u);
            })
            .catch((error) => message.error(extractErrorMessage(error, "加载媒体失败")))
            .finally(() => alive && setLoading(false));
        return () => {
            alive = false;
            if (objectUrl) URL.revokeObjectURL(objectUrl);
        };
    }, [userId, item.storageKey, message]);

    return (
        <div className="flex h-40 items-center justify-center overflow-hidden rounded-lg border border-stone-200 bg-stone-50 dark:border-stone-700 dark:bg-stone-800">
            {loading ? (
                <Spin />
            ) : !url ? (
                <span className="text-xs text-stone-400">无法加载</span>
            ) : item.kind === "video" ? (
                <video src={url} controls className="max-h-full max-w-full" />
            ) : item.kind === "audio" ? (
                <audio src={url} controls className="w-full px-2" />
            ) : (
                <img src={url} alt={item.storageKey} className="max-h-full max-w-full object-contain" />
            )}
        </div>
    );
}

// UserMediaModal：admin 查看某用户生成的图/视频，并可切到「调用记录」排查报错。
export default function UserMediaModal({
    user,
    onClose,
}: {
    user: AdminUser | null;
    onClose: () => void;
}) {
    const { message } = App.useApp();
    const [tab, setTab] = useState<"media" | "records">("media");
    const [media, setMedia] = useState<UserMediaItem[]>([]);
    const [records, setRecords] = useState<UsageRecord[]>([]);
    const [onlyErrors, setOnlyErrors] = useState(false);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (!user) return;
        setTab("media");
        setOnlyErrors(false);
    }, [user]);

    useEffect(() => {
        if (!user) return;
        let alive = true;
        setLoading(true);
        const task =
            tab === "media"
                ? fetchUserMedia(user.id).then((items) => alive && setMedia(items))
                : fetchUserUsageRecords(user.id, { onlyErrors }).then(
                      (items) => alive && setRecords(items),
                  );
        task
            .catch((error) => alive && message.error(extractErrorMessage(error, "加载失败")))
            .finally(() => alive && setLoading(false));
        return () => {
            alive = false;
        };
    }, [user, tab, onlyErrors, message]);

    return (
        <Modal
            open={user !== null}
            title={`用户内容 · ${user?.displayName || user?.email || ""}`}
            onCancel={onClose}
            footer={null}
            width={900}
            destroyOnClose
        >
            <Segmented
                value={tab}
                onChange={(v) => setTab(v as "media" | "records")}
                options={[
                    { label: "生成媒体", value: "media" },
                    { label: "调用记录", value: "records" },
                ]}
                className="mb-4"
            />

            {tab === "media" ? (
                loading ? (
                    <div className="flex h-40 items-center justify-center">
                        <Spin />
                    </div>
                ) : media.length === 0 ? (
                    <Empty description="该用户暂无媒体文件" />
                ) : (
                    <div className="grid max-h-[60vh] grid-cols-2 gap-3 overflow-y-auto sm:grid-cols-3">
                        {media.map((item) => (
                            <div key={item.storageKey} className="space-y-1">
                                <MediaThumb userId={user!.id} item={item} />
                                <div className="flex items-center justify-between text-xs text-stone-400">
                                    <Tag>{CAP_LABELS[item.kind] ?? item.kind}</Tag>
                                    <span>{(item.bytes / 1024).toFixed(0)} KB</span>
                                </div>
                            </div>
                        ))}
                    </div>
                )
            ) : (
                <>
                    <Segmented
                        value={onlyErrors ? "error" : "all"}
                        onChange={(v) => setOnlyErrors(v === "error")}
                        options={[
                            { label: "全部", value: "all" },
                            { label: "仅报错", value: "error" },
                        ]}
                        size="small"
                        className="mb-3"
                    />
                    <Table<UsageRecord>
                        rowKey="id"
                        size="small"
                        loading={loading}
                        dataSource={records}
                        scroll={{ y: "50vh" }}
                        pagination={{ pageSize: 20, hideOnSinglePage: true }}
                        columns={[
                            {
                                title: "时间",
                                dataIndex: "createdAt",
                                width: 160,
                                render: (t: string) => (
                                    <span className="text-xs text-stone-500">
                                        {new Date(t).toLocaleString("zh-CN")}
                                    </span>
                                ),
                            },
                            {
                                title: "能力",
                                dataIndex: "capability",
                                width: 70,
                                render: (cap: string) => CAP_LABELS[cap] ?? cap,
                            },
                            { title: "模型", dataIndex: "model", ellipsis: true },
                            {
                                title: "状态",
                                dataIndex: "status",
                                width: 90,
                                render: (status: string, r) =>
                                    status === "error" ? (
                                        <Tag color="red">失败 {r.httpStatus || ""}</Tag>
                                    ) : (
                                        <Tag color="green">成功</Tag>
                                    ),
                            },
                            {
                                title: "错误信息",
                                dataIndex: "errorMessage",
                                render: (msg: string) =>
                                    msg ? (
                                        <span className="text-xs text-red-500" title={msg}>
                                            {msg}
                                        </span>
                                    ) : (
                                        <span className="text-stone-300">—</span>
                                    ),
                            },
                        ]}
                    />
                </>
            )}
        </Modal>
    );
}
