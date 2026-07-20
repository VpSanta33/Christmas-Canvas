import axios from "axios";

/**
 * 后端错误响应统一形如 `{ "error": "message" }`（见 server/internal/httpx）。
 * 部分上游 AI 渠道透传的错误则是 `{ error: { message } }` 或 `{ msg }`。
 * 这里集中处理这些形态 + 常见 HTTP 状态码，供全站错误提示复用，避免各处各写一份易踩错字段。
 */
export function extractErrorMessage(error: unknown, fallback = "操作失败"): string {
    if (axios.isCancel(error)) return "请求已取消";
    if (axios.isAxiosError<BackendErrorShape>(error)) {
        const data = error.response?.data;
        const fromBody = (typeof data?.error === "string" ? data.error : data?.error?.message) ?? data?.message ?? data?.msg;
        if (fromBody) return fromBody;
        return statusMessage(error.response?.status, fallback);
    }
    if (error instanceof DOMException && error.name === "AbortError") return "请求已取消";
    return error instanceof Error ? error.message : fallback;
}

export function extractErrorCode(error: unknown): string | undefined {
    if (!axios.isAxiosError<BackendErrorShape>(error)) return undefined;
    return error.response?.data?.code;
}

type BackendErrorShape = {
    error?: string | { message?: string };
    code?: string;
    message?: string;
    msg?: string;
};

function statusMessage(status: number | undefined, fallback: string): string {
    if (status === 401) return "登录状态已失效，请重新登录";
    if (status === 403) return "当前操作没有权限，或平台尚未开放此功能";
    if (status === 402) return "请求未被上游服务接受";
    if (status === 429) return "请求过于频繁，请稍后重试";
    if (status === 502 || status === 503 || status === 504) return "上游服务暂不可用，请稍后重试";
    return status ? `${fallback}（${status}）` : fallback;
}
