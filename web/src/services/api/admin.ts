import { httpClient } from "@/services/http-client";

export type AdminUser = {
    id: string;
    email: string;
    emailVerified: boolean;
    displayName: string;
    role: string;
    disabled: boolean;
    createdAt: string;
};

export type CreateUserPayload = {
    email: string;
    password: string;
    displayName?: string;
    role?: "user" | "operator" | "admin";
};

export async function listUsers(): Promise<AdminUser[]> {
    const { data } = await httpClient.get<{ users: AdminUser[] }>("/admin/users");
    return data.users ?? [];
}

export async function createUser(payload: CreateUserPayload): Promise<AdminUser> {
    const { data } = await httpClient.post<{ user: AdminUser }>("/admin/users", payload);
    return data.user;
}

export async function deleteUser(id: string): Promise<void> {
    await httpClient.delete(`/admin/users/${id}`, { headers: { "X-Admin-Confirm": "confirmed" } });
}

export async function setUserRole(id: string, role: "user" | "operator" | "admin"): Promise<void> {
    await httpClient.post(`/admin/users/${id}/role`, { role }, { headers: { "X-Admin-Confirm": "confirmed" } });
}

export async function setUserDisabled(id: string, disabled: boolean): Promise<void> {
    await httpClient.post(`/admin/users/${id}/disabled`, { disabled });
}

export async function revokeUserSessions(id: string): Promise<void> {
    await httpClient.post(`/admin/users/${id}/revoke-sessions`, {}, { headers: { "X-Admin-Confirm": "confirmed" } });
}

export type AdminOverview = {
    users: { total: number; disabled: number };
    storage: { files: number; bytes: number };
    content: { contestPending: number; contestApproved: number };
};

export async function fetchOverview(): Promise<AdminOverview> {
    const { data } = await httpClient.get<AdminOverview>("/admin/overview");
    return data;
}

export type UserMediaItem = {
    storageKey: string;
    kind: string;
    mimeType: string;
    bytes: number;
    createdAt: string;
};

export async function fetchUserMedia(id: string): Promise<UserMediaItem[]> {
    const { data } = await httpClient.get<{ items: UserMediaItem[] }>(`/admin/users/${id}/media`);
    return data.items ?? [];
}

export async function fetchUserMediaBlob(id: string, storageKey: string): Promise<string> {
    const { data } = await httpClient.get<Blob>(`/admin/users/${id}/media/${encodeURIComponent(storageKey)}`, { responseType: "blob" });
    return URL.createObjectURL(data);
}

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
    featured: boolean;
    createdAt: string;
};

export async function fetchAdminContest(status: AdminContestStatus | "all"): Promise<AdminContestEntry[]> {
    const { data } = await httpClient.get<{ items: AdminContestEntry[] }>("/admin/contest", { params: { status } });
    return data.items ?? [];
}

export async function reviewContestEntry(id: string, action: "approve" | "reject", note?: string): Promise<void> {
    await httpClient.post(`/admin/contest/${id}/review`, { action, note });
}

export async function featureContestEntry(id: string, featured: boolean): Promise<void> {
    await httpClient.post(`/admin/contest/${id}/featured`, { featured });
}

export async function fetchAdminContestBlob(id: string, kind: "cover" | "media"): Promise<string> {
    const { data } = await httpClient.get<Blob>(`/contest/${encodeURIComponent(id)}/${kind}`, { responseType: "blob" });
    return URL.createObjectURL(data);
}

export type PlatformSettings = { siteName: string; logoUrl: string; allowRegistration: boolean };

export async function fetchPlatformSettings(): Promise<PlatformSettings> {
    const { data } = await httpClient.get<PlatformSettings>("/admin/platform");
    return data;
}

export async function updatePlatformSettings(settings: PlatformSettings): Promise<void> {
    await httpClient.put("/admin/platform", settings);
}

export type AnnouncementSettings = { announcement: string; maintenanceEnabled: boolean; maintenanceNotice: string };

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

export type StorageProvider = "aliyun" | "tencent" | "aws" | "s3";

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

export type StorageCleanupStats = { activeFiles: number; activeBytes: number; trashedFiles: number; trashedBytes: number; expiredFiles: number };
export type StorageCleanupResult = { deletedFiles: number; deletedBytes: number; failedFiles: number };

export async function fetchStorageCleanupStats(): Promise<StorageCleanupStats> {
    const { data } = await httpClient.get<StorageCleanupStats>("/admin/storage-cleanup");
    return data;
}

export async function purgeExpiredStorageFiles(): Promise<StorageCleanupResult> {
    const { data } = await httpClient.post<StorageCleanupResult>("/admin/storage-cleanup", {}, { headers: { "X-Admin-Confirm": "confirmed" } });
    return data;
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
