import { httpClient } from "@/services/http-client";
import { normalizeGenerationPricing, type GenerationPricing } from "@/stores/use-config-store";

// 对应后端 internal/proxy/admin.go 与 internal/admin/*。
// 所有端点挂在 /admin 下，经 RequireAdmin 中间件保护。

export type ChannelModel = { name: string; capability: string; cost: number; enabled?: boolean; sortOrder?: number; generationPricing?: GenerationPricing };

export type ModelDefaults = {
    image: string;
    video: string;
    text: string;
    audio: string;
};

// 管理端渠道视图不含明文 apiKey（后端 PublicChannel 不返回密钥）。
export type AdminChannel = {
    id: string;
    name: string;
    baseUrl: string;
    apiFormat: string;
    models: ChannelModel[];
    enabled: boolean;
    priority: number;
    autoPaused: boolean;
    pausedReason: string;
    healthUpdatedAt?: string;
    keyUpdatedAt?: string;
    keyExpiresAt?: string;
};

export type ChannelPayload = {
    name: string;
    baseUrl: string;
    apiKey?: string; // 更新时留空表示保留原密钥
    apiFormat: string;
    models: ChannelModel[];
    enabled: boolean;
    priority: number;
    keyExpiresAt?: string;
};

export async function listChannels(): Promise<AdminChannel[]> {
    const { data } = await httpClient.get<{ channels: AdminChannel[] }>("/admin/channels");
    return data.channels ?? [];
}

export type ModelOperations = {
    defaults: ModelDefaults;
    failoverEnabled: boolean;
    generationPricing: GenerationPricing;
};

export async function fetchModelDefaults(): Promise<ModelOperations> {
    const { data } = await httpClient.get<{ defaults: Partial<ModelDefaults>; failoverEnabled?: boolean; generationPricing?: Partial<GenerationPricing> }>("/admin/model-defaults");
    return {
        defaults: { image: "", video: "", text: "", audio: "", ...data.defaults },
        failoverEnabled: data.failoverEnabled !== false,
        generationPricing: normalizeGenerationPricing(data.generationPricing),
    };
}

export async function updateModelDefaults(operations: ModelOperations): Promise<void> {
    await httpClient.put("/admin/model-defaults", { ...operations.defaults, failoverEnabled: operations.failoverEnabled, generationPricing: operations.generationPricing });
}

export async function createChannel(payload: ChannelPayload): Promise<string> {
    const { data } = await httpClient.post<{ id: string }>("/admin/channels", payload);
    return data.id;
}

export async function updateChannel(id: string, payload: ChannelPayload): Promise<void> {
    await httpClient.put(`/admin/channels/${id}`, payload);
}

export async function updateChannelModelPricing(channelId: string, model: string, generationPricing: GenerationPricing): Promise<void> {
    await httpClient.put(`/admin/channels/${channelId}/model-pricing`, { model, generationPricing });
}

export async function setChannelEnabled(id: string, enabled: boolean): Promise<void> {
    await httpClient.post(`/admin/channels/${id}/enabled`, { enabled });
}

export async function deleteChannel(id: string): Promise<void> {
    await httpClient.delete(`/admin/channels/${id}`, { headers: { "X-Admin-Confirm": "confirmed" } });
}

export type AdminUser = {
    id: string;
    email: string;
    emailVerified: boolean;
    displayName: string;
    role: string;
    disabled: boolean;
    dailyLimit: number;
    usedToday: number;
    credits: number;
    createdAt: string;
};

export async function listUsers(): Promise<AdminUser[]> {
    const { data } = await httpClient.get<{ users: AdminUser[] }>("/admin/users");
    return data.users ?? [];
}

export type CreateUserPayload = {
    email: string;
    password: string;
    displayName?: string;
    role?: "user" | "operator" | "admin";
    credits?: number;
};

// 管理员直接建号（不受开放注册开关限制），返回新用户。
export async function createUser(payload: CreateUserPayload): Promise<AdminUser> {
    const { data } = await httpClient.post<{ user: AdminUser }>("/admin/users", payload);
    return data.user;
}

// 删除用户及其全部数据（画布/资产/媒体/用量/积分流水一并清除，不可恢复）。
export async function deleteUser(id: string): Promise<void> {
    await httpClient.delete(`/admin/users/${id}`, { headers: { "X-Admin-Confirm": "confirmed" } });
}

export async function setUserRole(id: string, role: "user" | "operator" | "admin"): Promise<void> {
    await httpClient.post(`/admin/users/${id}/role`, { role }, { headers: { "X-Admin-Confirm": "confirmed" } });
}

export async function setUserDisabled(id: string, disabled: boolean): Promise<void> {
    await httpClient.post(`/admin/users/${id}/disabled`, { disabled });
}

export async function setUserQuota(id: string, dailyLimit: number): Promise<void> {
    await httpClient.post(`/admin/users/${id}/quota`, { dailyLimit });
}

// 给用户充值积分（正数），返回充值后的余额。
export async function topupUserCredits(id: string, amount: number, note?: string): Promise<number> {
    const { data } = await httpClient.post<{ credits: number }>(`/admin/users/${id}/credits`, {
        amount,
        note,
    });
    return data.credits;
}

export async function revokeUserSessions(id: string): Promise<void> {
    await httpClient.post(`/admin/users/${id}/revoke-sessions`, {}, { headers: { "X-Admin-Confirm": "confirmed" } });
}

export type AdminOverview = {
    users: { total: number; disabled: number };
    channels: { total: number; enabled: number };
    usage: { today: number; last7Days: number; errorsToday: number; successRate: number };
    credits: { consumedLast7Days: number };
    storage: { files: number; bytes: number };
    content: { contestPending: number; contestApproved: number };
};

export async function fetchOverview(): Promise<AdminOverview> {
    const { data } = await httpClient.get<AdminOverview>("/admin/overview");
    return data;
}

export type AdminUsage = {
    daily: { date: string; count: number }[];
    byCapability: { capability: string; count: number }[];
    byChannel: { channelId: string; name: string; count: number }[];
    days: number;
};

export async function fetchUsageStats(days: number): Promise<AdminUsage> {
    const { data } = await httpClient.get<AdminUsage>("/admin/usage", { params: { days } });
    return {
        daily: data.daily ?? [],
        byCapability: data.byCapability ?? [],
        byChannel: data.byChannel ?? [],
        days: data.days,
    };
}

// 渠道健康探测结果，对应后端 proxy.HealthResult。
export type ChannelHealth = {
    ok: boolean;
    status: number;
    latencyMs: number;
    models: string[];
    message: string;
};

function normalizeChannelHealth(data: Partial<ChannelHealth> | null | undefined): ChannelHealth {
    return {
        ok: data?.ok === true,
        status: Number(data?.status) || 0,
        latencyMs: Number(data?.latencyMs) || 0,
        models: Array.isArray(data?.models) ? data.models.filter((model): model is string => typeof model === "string" && Boolean(model.trim())) : [],
        message: typeof data?.message === "string" ? data.message : "",
    };
}

// 测试已保存的渠道（用其存储的密钥）。
export async function testChannel(id: string): Promise<ChannelHealth> {
    const { data } = await httpClient.post<Partial<ChannelHealth>>(`/admin/channels/${id}/test`, {});
    return normalizeChannelHealth(data);
}

// 保存前用表单数据现场测试渠道连通性。
export async function testChannelDraft(payload: { baseUrl: string; apiKey: string; apiFormat: string }): Promise<ChannelHealth> {
    const { data } = await httpClient.post<Partial<ChannelHealth>>("/admin/channel-test", payload);
    return normalizeChannelHealth(data);
}

// 单条积分流水，对应后端 credits.LedgerItem。
export type LedgerItem = {
    delta: number;
    balanceAfter: number;
    reason: string;
    capability: string;
    model: string;
    note: string;
    createdAt: string;
};

// admin 下钻查看某用户的积分流水（充值 / 消费）。
export async function fetchUserLedger(id: string, limit = 50): Promise<LedgerItem[]> {
    const { data } = await httpClient.get<{ items: LedgerItem[] }>(`/admin/users/${id}/ledger`, {
        params: { limit },
    });
    return data.items ?? [];
}

// 用户生成/上传的一条媒体，对应后端 admin.mediaItem。
export type UserMediaItem = {
    storageKey: string;
    kind: string; // image | video | audio | file
    mimeType: string;
    bytes: number;
    createdAt: string;
};

export async function fetchUserMedia(id: string): Promise<UserMediaItem[]> {
    const { data } = await httpClient.get<{ items: UserMediaItem[] }>(`/admin/users/${id}/media`);
    return data.items ?? [];
}

// 构造 admin 媒体预览的 blob URL（带鉴权，不能直接用 <img src>，需走 httpClient）。
export async function fetchUserMediaBlob(id: string, storageKey: string): Promise<string> {
    const { data } = await httpClient.get<Blob>(`/admin/users/${id}/media/${encodeURIComponent(storageKey)}`, { responseType: "blob" });
    return URL.createObjectURL(data);
}

// 一条 AI 调用记录（含成败与错误信息），对应后端 admin.usageRecord。
export type UsageRecord = {
    id: number;
    capability: string;
    channelId: string;
    model: string;
    status: string; // ok | error
    httpStatus: number;
    errorMessage: string;
    createdAt: string;
};

// 查看某用户最近的 AI 调用记录；onlyErrors 仅返回失败记录，便于排障。
export async function fetchUserUsageRecords(id: string, opts: { limit?: number; onlyErrors?: boolean } = {}): Promise<UsageRecord[]> {
    const { data } = await httpClient.get<{ items: UsageRecord[] }>(`/admin/users/${id}/usage`, {
        params: {
            limit: opts.limit ?? 100,
            onlyErrors: opts.onlyErrors ? 1 : undefined,
        },
    });
    return data.items ?? [];
}

// 创作者大赛审核与结算，对应后端 internal/contest 的 AdminList / Review / Settle。
export type AdminContestStatus = "pending" | "approved" | "rejected";

export type AdminContestEntry = {
    id: string;
    title: string;
    description: string;
    recipeType: "prompt" | "skill";
    recipeContent: string;
    videoMimeType: string;
    authorId: string;
    authorName: string;
    authorEmail: string;
    likes: number;
    status: AdminContestStatus;
    reviewNote: string;
    settled: boolean;
    featured: boolean;
    createdAt: string;
};

// 拉取待审 / 已通过 / 已拒绝 / 全部作品；status 传 "all" 表示不过滤。
export async function fetchAdminContest(status: AdminContestStatus | "all"): Promise<AdminContestEntry[]> {
    const { data } = await httpClient.get<{ items: AdminContestEntry[] }>("/admin/contest", {
        params: { status },
    });
    return data.items ?? [];
}

// 通过或拒绝一件作品；note 为可选的审核备注。
export async function reviewContestEntry(id: string, action: "approve" | "reject", note?: string): Promise<void> {
    await httpClient.post(`/admin/contest/${id}/review`, { action, note });
}

export async function featureContestEntry(id: string, featured: boolean): Promise<void> {
    await httpClient.post(`/admin/contest/${id}/featured`, { featured });
}

// 给作者手动结算积分（每件作品仅可结算一次，重复结算后端返回 409）。
export async function settleContestEntry(id: string, amount: number, note?: string): Promise<number> {
    const { data } = await httpClient.post<{ balance: number }>(`/admin/contest/${id}/settle`, { amount, note });
    return data.balance;
}

// 管理端预览大赛作品的视频/封面：走鉴权 blob，转成 objectURL。
export async function fetchAdminContestBlob(id: string, kind: "cover" | "media"): Promise<string> {
    const { data } = await httpClient.get<Blob>(`/contest/${encodeURIComponent(id)}/${kind}`, { responseType: "blob" });
    return URL.createObjectURL(data);
}

export type PlatformSettings = {
    siteName: string;
    logoUrl: string;
    allowRegistration: boolean;
    registerGrantCredits: number;
    autoPauseEnabled: boolean;
    autoPauseFailures: number;
};

export async function fetchPlatformSettings(): Promise<PlatformSettings> {
    const { data } = await httpClient.get<PlatformSettings>("/admin/platform");
    return data;
}

export async function updatePlatformSettings(settings: PlatformSettings): Promise<void> {
    await httpClient.put("/admin/platform", settings);
}

export type AnnouncementSettings = {
    announcement: string;
    maintenanceEnabled: boolean;
    maintenanceNotice: string;
};

export async function fetchAnnouncementSettings(): Promise<AnnouncementSettings> {
    const { data } = await httpClient.get<AnnouncementSettings>("/admin/announcement-settings");
    return data;
}

export async function updateAnnouncementSettings(settings: AnnouncementSettings): Promise<void> {
    await httpClient.put("/admin/announcement-settings", settings);
}

export type EmailSettings = {
    enabled: boolean;
    host: string;
    port: number;
    mode: "starttls" | "tls" | "none";
    username: string;
    passwordConfigured: boolean;
    fromEmail: string;
    fromName: string;
    password?: string;
};

export async function fetchEmailSettings(): Promise<EmailSettings> {
    const { data } = await httpClient.get<EmailSettings>("/admin/email-settings");
    return data;
}

export async function updateEmailSettings(settings: EmailSettings): Promise<void> {
    await httpClient.put("/admin/email-settings", settings);
}

export async function testEmailSettings(email: string): Promise<void> {
    await httpClient.post("/admin/email-settings/test", { email });
}

export type StorageProvider = "aliyun" | "tencent" | "aws" | "minio";

export type StorageSettings = {
    configured: boolean;
    source: "environment" | "database";
    enabled: boolean;
    provider: StorageProvider;
    endpoint: string;
    bucket: string;
    region: string;
    useSSL: boolean;
    publicBaseUrl: string;
    pathPrefix: string;
    imagePathPrefix: string;
    videoPathPrefix: string;
    trashRetentionDays: number;
    accessKeyConfigured: boolean;
    secretKeyConfigured: boolean;
    available: boolean;
    statusMessage: string;
    accessKey?: string;
    secretKey?: string;
};

export async function fetchStorageSettings(): Promise<StorageSettings> {
    const { data } = await httpClient.get<StorageSettings>("/admin/storage-settings");
    return data;
}

export async function updateStorageSettings(settings: StorageSettings): Promise<StorageSettings> {
    const { data } = await httpClient.put<StorageSettings>("/admin/storage-settings", settings);
    return data;
}

export async function testStorageSettings(settings: StorageSettings): Promise<string> {
    const { data } = await httpClient.post<{ ok: boolean; message: string }>("/admin/storage-settings/test", settings);
    return data.message;
}

export type StorageCleanupStats = {
    activeFiles: number;
    activeBytes: number;
    trashedFiles: number;
    trashedBytes: number;
    expiredFiles: number;
};

export type StorageCleanupResult = { deletedFiles: number; deletedBytes: number; failedFiles: number };

export async function fetchStorageCleanupStats(): Promise<StorageCleanupStats> {
    const { data } = await httpClient.get<StorageCleanupStats>("/admin/storage-cleanup");
    return data;
}

export async function purgeExpiredStorageFiles(): Promise<StorageCleanupResult> {
    const { data } = await httpClient.post<StorageCleanupResult>("/admin/storage-cleanup", {}, { headers: { "X-Admin-Confirm": "confirmed" } });
    return data;
}

export type CallLog = {
    id: number;
    requestId: string;
    userId: string;
    userEmail: string;
    capability: string;
    channelId: string;
    channelName: string;
    model: string;
    status: string;
    httpStatus: number;
    latencyMs: number;
    credits: number;
    refunded: boolean;
    errorMessage: string;
    createdAt: string;
};

export async function fetchCallLogs(params: { q?: string; status?: string; channelId?: string; limit?: number } = {}): Promise<CallLog[]> {
    const { data } = await httpClient.get<{ items: CallLog[] }>("/admin/call-logs", { params });
    return data.items ?? [];
}

export type ChannelHealthSummary = {
    channelId: string;
    name: string;
    enabled: boolean;
    autoPaused: boolean;
    pausedReason: string;
    calls24h: number;
    successRate: number;
    averageLatencyMs: number;
    refundedCredits: number;
    lastError: string;
    lastSeenAt: string;
    severity: "healthy" | "warning" | "critical";
};

export async function fetchChannelHealth(): Promise<ChannelHealthSummary[]> {
    const { data } = await httpClient.get<{ items: ChannelHealthSummary[] }>("/admin/channel-health");
    return data.items ?? [];
}

export type AuditLog = {
    id: number;
    actorId: string;
    actorEmail: string;
    actorRole: string;
    action: string;
    target: string;
    requestId: string;
    httpStatus: number;
    ipAddress: string;
    userAgent: string;
    createdAt: string;
};

export async function fetchAuditLogs(q = "", limit = 100): Promise<AuditLog[]> {
    const { data } = await httpClient.get<{ items: AuditLog[] }>("/admin/audit-logs", { params: { q, limit } });
    return data.items ?? [];
}
