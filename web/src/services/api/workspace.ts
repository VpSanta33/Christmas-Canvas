import { httpClient } from "@/services/http-client";

export type WorkspaceTask = {
    id: string;
    clientKey: string;
    capability: "image" | "video" | "text" | "audio";
    status: "pending" | "running" | "done" | "failed" | "completed";
    title: string;
    prompt: string;
    model: string;
    request?: Record<string, unknown>;
    result?: Record<string, unknown>;
    error?: string;
    createdAt: string;
    updatedAt: string;
    completedAt?: string;
};

export async function fetchWorkspaceTasks(params: { status?: string; capability?: string; q?: string } = {}) {
    const { data } = await httpClient.get<{ items: WorkspaceTask[] }>("/tasks", { params });
    return data.items ?? [];
}

export async function upsertWorkspaceTask(task: Omit<WorkspaceTask, "id" | "createdAt" | "updatedAt" | "completedAt">) {
    const { data } = await httpClient.post<{ id: string; clientKey: string }>("/tasks", task);
    return data;
}

export async function deleteWorkspaceTask(id: string) {
    await httpClient.delete(`/tasks/${encodeURIComponent(id)}`);
}

export type CanvasVersion = {
    id: string;
    projectId: string;
    label: string;
    snapshot: Record<string, unknown>;
    createdAt: string;
};

export async function fetchCanvasVersions(projectId: string) {
    const { data } = await httpClient.get<{ items: CanvasVersion[] }>(`/projects/${encodeURIComponent(projectId)}/versions`);
    return data.items ?? [];
}

export async function createCanvasVersion(projectId: string, label: string, snapshot: Record<string, unknown>) {
    const { data } = await httpClient.post<{ id: string }>(`/projects/${encodeURIComponent(projectId)}/versions`, { label, snapshot });
    return data.id;
}

export async function restoreCanvasVersion(projectId: string, versionId: string) {
    const { data } = await httpClient.post<{ project: Record<string, unknown> }>(`/projects/${encodeURIComponent(projectId)}/versions/${encodeURIComponent(versionId)}/restore`);
    return data.project;
}

export async function setCanvasProjectTeam(projectId: string, teamId: string | null) {
    await httpClient.put(`/projects/${encodeURIComponent(projectId)}/team`, { teamId });
}

export type CanvasShare = {
    id: string;
    projectId: string;
    token: string;
    permission: "view" | "copy";
    expiresAt?: string;
    createdAt: string;
};

export async function fetchCanvasShares(projectId: string) {
    const { data } = await httpClient.get<{ items: CanvasShare[] }>(`/projects/${encodeURIComponent(projectId)}/shares`);
    return data.items ?? [];
}

export async function createCanvasShare(projectId: string, permission: CanvasShare["permission"] = "copy") {
    const { data } = await httpClient.post<CanvasShare>(`/projects/${encodeURIComponent(projectId)}/shares`, { permission });
    return data;
}

export async function deleteCanvasShare(projectId: string, shareId: string) {
    await httpClient.delete(`/projects/${encodeURIComponent(projectId)}/shares/${encodeURIComponent(shareId)}`);
}

export type SharedCanvas = { projectId: string; title: string; permission: "view" | "copy"; project: Record<string, unknown> };

export async function fetchSharedCanvas(token: string) {
    const { data } = await httpClient.get<SharedCanvas>(`/shared/${encodeURIComponent(token)}`);
    return data;
}

export async function copySharedCanvas(token: string) {
    const { data } = await httpClient.post<{ projectId: string; title: string; project: Record<string, unknown> }>(`/shared/${encodeURIComponent(token)}/copy`);
    return data;
}

export type WorkflowTemplate = {
    id: string;
    ownerId: string;
    name: string;
    description: string;
    tags: string[];
    visibility: "private" | "public";
    data: Record<string, unknown>;
    uses: number;
    createdAt: string;
    updatedAt: string;
};

export async function fetchWorkflowTemplates(q = "") {
    const { data } = await httpClient.get<{ items: WorkflowTemplate[] }>("/templates", { params: { q: q || undefined } });
    return data.items ?? [];
}

export async function createWorkflowTemplate(input: Pick<WorkflowTemplate, "name" | "description" | "tags" | "visibility" | "data">) {
    const { data } = await httpClient.post<{ id: string }>("/templates", input);
    return data.id;
}

export async function useWorkflowTemplate(id: string) {
    const { data } = await httpClient.post<{ data: Record<string, unknown> }>(`/templates/${encodeURIComponent(id)}/use`);
    return data.data;
}

export async function deleteWorkflowTemplate(id: string) {
    await httpClient.delete(`/templates/${encodeURIComponent(id)}`);
}

export type WorkspaceNotification = {
    id: string;
    type: string;
    title: string;
    body: string;
    data: Record<string, unknown>;
    read: boolean;
    createdAt: string;
};

export async function fetchNotifications() {
    const { data } = await httpClient.get<{ items: WorkspaceNotification[]; unread: number }>("/notifications");
    return data;
}

export async function markNotificationRead(id: string) {
    await httpClient.post(`/notifications/${encodeURIComponent(id)}/read`);
}

export async function markAllNotificationsRead() {
    await httpClient.post("/notifications/read-all");
}

export type WorkspaceTeam = { id: string; name: string; role: "owner" | "editor" | "viewer"; members: number; createdAt: string; updatedAt: string };
export type WorkspaceTeamMember = { id: string; email: string; displayName: string; role: "owner" | "editor" | "viewer"; createdAt: string };

export async function fetchTeams() {
    const { data } = await httpClient.get<{ items: WorkspaceTeam[] }>("/teams");
    return data.items ?? [];
}

export async function createTeam(name: string) {
    const { data } = await httpClient.post<{ id: string }>("/teams", { name });
    return data.id;
}

export async function fetchTeamMembers(teamId: string) {
    const { data } = await httpClient.get<{ items: WorkspaceTeamMember[] }>(`/teams/${encodeURIComponent(teamId)}/members`);
    return data.items ?? [];
}

export async function addTeamMember(teamId: string, email: string, role: "editor" | "viewer" = "editor") {
    await httpClient.post(`/teams/${encodeURIComponent(teamId)}/members`, { email, role });
}

export async function removeTeamMember(teamId: string, userId: string) {
    await httpClient.delete(`/teams/${encodeURIComponent(teamId)}/members/${encodeURIComponent(userId)}`);
}
