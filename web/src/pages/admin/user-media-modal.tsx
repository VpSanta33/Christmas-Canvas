import { useEffect, useState } from "react";
import { App, Empty, Modal, Spin, Tag } from "antd";

import { fetchUserMedia, fetchUserMediaBlob, type AdminUser, type UserMediaItem } from "@/services/api/admin";
import { extractErrorMessage } from "@/utils/http-error";

const KIND_LABELS: Record<string, string> = { image: "图片", video: "视频", audio: "音频", file: "文件" };

function MediaThumb({ userId, item }: { userId: string; item: UserMediaItem }) {
    const { message } = App.useApp();
    const [url, setUrl] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let objectUrl: string | null = null;
        let alive = true;
        fetchUserMediaBlob(userId, item.storageKey)
            .then((value) => {
                if (!alive) return URL.revokeObjectURL(value);
                objectUrl = value;
                setUrl(value);
            })
            .catch((error) => message.error(extractErrorMessage(error, "加载媒体失败")))
            .finally(() => alive && setLoading(false));
        return () => {
            alive = false;
            if (objectUrl) URL.revokeObjectURL(objectUrl);
        };
    }, [item.storageKey, message, userId]);

    return (
        <div className="flex h-40 items-center justify-center overflow-hidden rounded-lg border border-stone-200 bg-stone-50 dark:border-stone-700 dark:bg-stone-800">
            {loading ? <Spin /> : !url ? <span className="text-xs text-stone-400">无法加载</span> : item.kind === "video" ? <video src={url} controls className="max-h-full max-w-full" /> : item.kind === "audio" ? <audio src={url} controls className="w-full px-2" /> : <img src={url} alt="" className="max-h-full max-w-full object-contain" />}
        </div>
    );
}

export default function UserMediaModal({ user, onClose }: { user: AdminUser | null; onClose: () => void }) {
    const { message } = App.useApp();
    const [items, setItems] = useState<UserMediaItem[]>([]);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (!user) return;
        let alive = true;
        setLoading(true);
        fetchUserMedia(user.id)
            .then((value) => alive && setItems(value))
            .catch((error) => alive && message.error(extractErrorMessage(error, "加载媒体失败")))
            .finally(() => alive && setLoading(false));
        return () => {
            alive = false;
        };
    }, [message, user]);

    return (
        <Modal open={user !== null} title={`用户媒体 · ${user?.displayName || user?.email || ""}`} onCancel={onClose} footer={null} width={900} destroyOnHidden>
            {loading ? (
                <div className="grid h-40 place-items-center"><Spin /></div>
            ) : items.length ? (
                <div className="grid max-h-[60vh] grid-cols-2 gap-3 overflow-y-auto sm:grid-cols-3">
                    {items.map((item) => (
                        <div key={item.storageKey} className="space-y-1">
                            <MediaThumb userId={user!.id} item={item} />
                            <div className="flex items-center justify-between text-xs text-stone-400">
                                <Tag>{KIND_LABELS[item.kind] || item.kind}</Tag>
                                <span>{(item.bytes / 1024).toFixed(0)} KB</span>
                            </div>
                        </div>
                    ))}
                </div>
            ) : (
                <Empty description="该用户暂无媒体文件" />
            )}
        </Modal>
    );
}
