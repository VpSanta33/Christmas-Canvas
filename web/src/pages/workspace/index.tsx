import { useEffect, useMemo, useState } from "react";
import { App, Avatar, Button, Card, Empty, Input, List, Select, Spin, Tabs, Tag, Tooltip } from "antd";
import { Bell, Check, Copy, FileClock, FolderKanban, Layers3, Link2, Plus, RefreshCw, Repeat2, Search, Share2, Sparkles, Trash2, UsersRound, X } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";

import { isBackendMode } from "@/constant/runtime-config";
import { useCanvasStore, type CanvasProject } from "@/stores/canvas/use-canvas-store";
import { useWorkbenchAgentStore } from "@/stores/use-workbench-agent-store";
import { useConfigStore } from "@/stores/use-config-store";
import { readGenerationTasks, type GenerationTaskItem } from "@/services/generation-history";
import { resolveImageUrl } from "@/services/image-storage";
import { resolveMediaUrl } from "@/services/file-storage";
import { syncAppDataToBackend } from "@/services/app-sync";
import {
    addTeamMember,
    copySharedCanvas,
    createCanvasShare,
    createCanvasVersion,
    createTeam,
    createWorkflowTemplate,
    deleteCanvasShare,
    deleteWorkspaceTask,
    deleteWorkflowTemplate,
    fetchCanvasShares,
    fetchCanvasVersions,
    fetchNotifications,
    fetchSharedCanvas,
    fetchTeamMembers,
    fetchTeams,
    fetchWorkflowTemplates,
    fetchWorkspaceTasks,
    markAllNotificationsRead,
    markNotificationRead,
    removeTeamMember,
    restoreCanvasVersion,
    setCanvasProjectTeam,
    useWorkflowTemplate as fetchTemplateData,
    type CanvasShare,
    type CanvasVersion,
    type WorkspaceNotification,
    type WorkspaceTask,
    type WorkspaceTeam,
    type WorkspaceTeamMember,
    type WorkflowTemplate,
} from "@/services/api/workspace";

type WorkspaceTab = "tasks" | "canvas" | "templates" | "notifications" | "teams";

export default function WorkspacePage({ initialTab = "tasks" }: { initialTab?: WorkspaceTab }) {
    const [tab, setTab] = useState<WorkspaceTab>(initialTab);
    return (
        <main className="h-full overflow-y-auto bg-[#f7f7f5] text-stone-950 dark:bg-[#0d0d0c] dark:text-stone-100">
            <header className="border-b border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-950">
                <div className="mx-auto max-w-7xl px-5 py-7 sm:px-8">
                    <div className="flex flex-wrap items-end justify-between gap-4">
                        <div>
                            <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-sky-600 dark:text-sky-400"><Layers3 className="size-3.5" />WORKSPACE</div>
                            <h1 className="text-3xl font-semibold tracking-normal">工作空间</h1>
                            <p className="mt-2 text-sm text-stone-500">任务、画布、模板、通知和团队统一管理</p>
                        </div>
                        <Button icon={<RefreshCw className="size-4" />} onClick={() => window.dispatchEvent(new Event("infinite-canvas:workspace-refresh"))}>刷新</Button>
                    </div>
                    <Tabs className="mt-5" activeKey={tab} onChange={(key) => setTab(key as WorkspaceTab)} items={workspaceTabs} />
                </div>
            </header>
            <div className="mx-auto max-w-7xl px-5 py-7 sm:px-8">
                {tab === "tasks" ? <TaskCenter /> : isBackendMode() ? null : <Empty description="该工作空间能力需要连接后端模式" />}
                {tab === "canvas" && isBackendMode() ? <CanvasCollaboration /> : null}
                {tab === "templates" && isBackendMode() ? <TemplateCenter /> : null}
                {tab === "notifications" && isBackendMode() ? <NotificationCenter /> : null}
                {tab === "teams" && isBackendMode() ? <TeamCenter /> : null}
            </div>
        </main>
    );
}

const workspaceTabs = [
    { key: "tasks", label: <span className="inline-flex items-center gap-1.5"><FileClock className="size-4" />任务中心</span> },
    { key: "canvas", label: <span className="inline-flex items-center gap-1.5"><FolderKanban className="size-4" />画布协作</span> },
    { key: "templates", label: <span className="inline-flex items-center gap-1.5"><Sparkles className="size-4" />工作流模板</span> },
    { key: "notifications", label: <span className="inline-flex items-center gap-1.5"><Bell className="size-4" />通知中心</span> },
    { key: "teams", label: <span className="inline-flex items-center gap-1.5"><UsersRound className="size-4" />团队空间</span> },
];

type UnifiedTask = WorkspaceTask & { thumbnails: string[]; local?: boolean };

function TaskCenter() {
    const { message, modal } = App.useApp();
    const navigate = useNavigate();
    const dispatchImage = useWorkbenchAgentStore((state) => state.dispatchImage);
    const dispatchVideo = useWorkbenchAgentStore((state) => state.dispatchVideo);
    const updateConfig = useConfigStore((state) => state.updateConfig);
    const [items, setItems] = useState<UnifiedTask[]>([]);
    const [loading, setLoading] = useState(true);
    const [query, setQuery] = useState("");
    const [capability, setCapability] = useState("all");
    const [selected, setSelected] = useState<string[]>([]);

    const load = async () => {
        setLoading(true);
        const [remote, local] = await Promise.all([fetchWorkspaceTasks().catch(() => []), isBackendMode() ? Promise.resolve([]) : readGenerationTasks()]);
        const remoteKeys = new Set(remote.map((item) => item.clientKey).filter(Boolean));
        const localItems: UnifiedTask[] = local
            .filter((item) => !remoteKeys.has(`${item.capability}:${item.id}`))
            .map(localTaskToUnified);
        setItems([...remote.map((item) => ({ ...item, thumbnails: resultThumbnails(item.result), local: false })), ...localItems]);
        setLoading(false);
    };

    useEffect(() => {
        void load();
        const refresh = () => void load();
        window.addEventListener("infinite-canvas:workspace-refresh", refresh);
        window.addEventListener("infinite-canvas:generation-history-changed", refresh);
        return () => {
            window.removeEventListener("infinite-canvas:workspace-refresh", refresh);
            window.removeEventListener("infinite-canvas:generation-history-changed", refresh);
        };
    }, []);

    const filtered = useMemo(() => {
        const keyword = query.trim().toLowerCase();
        return items.filter((item) => {
            if (capability !== "all" && item.capability !== capability) return false;
            return !keyword || `${item.title} ${item.prompt} ${item.model}`.toLowerCase().includes(keyword);
        });
    }, [capability, items, query]);

    const reuse = (item: UnifiedTask) => {
        const prompt = item.prompt.trim();
        if (!prompt) {
            message.warning("这条任务没有可复用的提示词");
            return;
        }
        const config = item.request?.config;
        if (config && typeof config === "object") {
            const fields = item.capability === "video" ? ["videoModel", "size", "vquality", "videoSeconds", "videoGenerateAudio", "videoWatermark"] : ["imageModel", "quality", "size", "count"];
            fields.forEach((field) => {
                const value = (config as Record<string, unknown>)[field];
                if (typeof value === "string") updateConfig(field as "imageModel" | "quality" | "size" | "count", value);
            });
        }
        if (item.capability === "video") {
            dispatchVideo({ prompt, run: false });
            navigate("/video");
        } else {
            updateConfig("count", "1");
            dispatchImage({ prompt, run: false });
            navigate("/image");
        }
    };

    const batchGenerate = (capabilityToRun: "image" | "video") => {
        if (capabilityToRun === "image") {
            updateConfig("count", "4");
            dispatchImage({ prompt: "", run: false });
            navigate("/image");
        } else {
            dispatchVideo({ prompt: "", run: false });
            navigate("/video");
        }
        message.info(capabilityToRun === "image" ? "已打开 4 张批量生图配置" : "已打开批量视频工作台");
    };

    const deleteSelected = () => {
        modal.confirm({
            title: "删除选中的任务记录？",
            content: "只删除任务历史，不会删除已保存的画布或资产。",
            okButtonProps: { danger: true },
            onOk: async () => {
                await Promise.all(selected.filter((id) => items.find((item) => item.id === id && !item.local)).map(deleteWorkspaceTask));
                setSelected([]);
                await load();
            },
        });
    };

    const compareItems = items.filter((item) => selected.includes(item.id) && item.thumbnails.length);
    return (
        <div className="space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap gap-2">
                    <Select value={capability} onChange={setCapability} options={[{ label: "全部类型", value: "all" }, { label: "图片", value: "image" }, { label: "视频", value: "video" }, { label: "文本", value: "text" }]} />
                    <Input allowClear value={query} prefix={<Search className="size-4 text-stone-400" />} placeholder="搜索提示词、模型或任务" onChange={(event) => setQuery(event.target.value)} />
                </div>
                <div className="flex flex-wrap gap-2">
                    <Button icon={<ImagePlusIcon />} onClick={() => batchGenerate("image")}>批量生图</Button>
                    <Button icon={<VideoIcon />} onClick={() => batchGenerate("video")}>批量视频</Button>
                    {selected.length ? <Button danger icon={<Trash2 className="size-4" />} onClick={deleteSelected}>删除</Button> : null}
                </div>
            </div>
            {compareItems.length > 1 ? <ComparisonStrip items={compareItems} onClear={() => setSelected([])} /> : null}
            {loading ? <div className="grid min-h-64 place-items-center"><Spin /></div> : filtered.length ? (
                <div className="grid gap-3 lg:grid-cols-2">
                    {filtered.map((item) => <TaskCard key={`${item.local ? "local" : "remote"}-${item.id}`} item={item} selected={selected.includes(item.id)} onSelect={(checked) => setSelected((current) => checked ? [...current, item.id] : current.filter((id) => id !== item.id))} onReuse={() => reuse(item)} />)}
                </div>
            ) : <Empty description="还没有生成任务" />}
        </div>
    );
}

function TaskCard({ item, selected, onSelect, onReuse }: { item: UnifiedTask; selected: boolean; onSelect: (checked: boolean) => void; onReuse: () => void }) {
    const status = item.status === "failed" ? { label: "失败", color: "error" } : item.status === "running" || item.status === "pending" ? { label: "进行中", color: "processing" } : { label: "已完成", color: "success" };
    return (
        <Card size="small" className={selected ? "border-sky-400 ring-1 ring-sky-300" : undefined}>
            <div className="flex items-start gap-3">
                <input type="checkbox" checked={selected} onChange={(event) => onSelect(event.target.checked)} className="mt-1 size-4 accent-sky-600" aria-label={`选择 ${item.title}`} />
                <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2"><strong className="truncate">{item.title || "未命名任务"}</strong><Tag color={status.color}>{status.label}</Tag><Tag>{item.capability}</Tag>{item.local ? <Tag>本地记录</Tag> : null}</div>
                    <p className="mt-2 line-clamp-2 text-sm text-stone-600 dark:text-stone-300">{item.prompt || "未记录提示词"}</p>
                    <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-stone-500"><span>{item.model || "未指定模型"}</span><span>·</span><span>{new Date(item.createdAt).toLocaleString("zh-CN", { hour12: false })}</span></div>
                </div>
                <Button type="text" size="small" icon={<Repeat2 className="size-4" />} onClick={onReuse} aria-label="一键复用" title="一键复用" />
            </div>
            {item.thumbnails.length ? <div className="mt-3 grid grid-cols-4 gap-2">{item.thumbnails.slice(0, 4).map((url, index) => <TaskThumbnail key={`${url}-${index}`} value={url} remote={!item.local} capability={item.capability} />)}</div> : null}
        </Card>
    );
}

function ComparisonStrip({ items, onClear }: { items: UnifiedTask[]; onClear: () => void }) {
    return <section className="border border-sky-200 bg-sky-50/60 p-4 dark:border-sky-900 dark:bg-sky-950/20"><div className="mb-3 flex items-center justify-between"><div className="flex items-center gap-2 text-sm font-semibold"><Layers3 className="size-4 text-sky-600" />结果对比 <Tag color="blue">{items.length} 个任务</Tag></div><Button type="text" size="small" icon={<X className="size-4" />} onClick={onClear} aria-label="清除对比" /></div><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{items.flatMap((item) => item.thumbnails.slice(0, 2).map((url, index) => <figure key={`${item.id}-${index}`} className="m-0 overflow-hidden bg-white dark:bg-stone-950"><TaskThumbnail value={url} remote={!item.local} capability={item.capability} /><figcaption className="truncate px-2 py-2 text-xs text-stone-500">{item.title}</figcaption></figure>))}</div></section>;
}

function CanvasCollaboration() {
    const { message, modal } = App.useApp();
    const projects = useCanvasStore((state) => state.projects);
    const replaceProjects = useCanvasStore((state) => state.replaceProjects);
    const [versions, setVersions] = useState<Record<string, CanvasVersion[]>>({});
    const [shares, setShares] = useState<Record<string, CanvasShare[]>>({});
    const [loading, setLoading] = useState<string | null>(null);
    const [teams, setTeams] = useState<WorkspaceTeam[]>([]);

    useEffect(() => {
        void Promise.all([fetchTeams(), syncAppDataToBackend().catch(() => undefined)]).then(([nextTeams]) => setTeams(nextTeams));
    }, []);

    const loadProjectMeta = async (id: string) => {
        const [nextVersions, nextShares] = await Promise.all([fetchCanvasVersions(id), fetchCanvasShares(id)]);
        setVersions((current) => ({ ...current, [id]: nextVersions }));
        setShares((current) => ({ ...current, [id]: nextShares }));
    };

    const createVersion = async (project: CanvasProject) => {
        const label = window.prompt("版本名称", `版本 ${new Date().toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}`)?.trim();
        if (!label) return;
        setLoading(project.id);
        try {
            await createCanvasVersion(project.id, label, project as unknown as Record<string, unknown>);
            await loadProjectMeta(project.id);
            message.success("画布版本已保存");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "保存版本失败");
        } finally {
            setLoading(null);
        }
    };

    const restore = (project: CanvasProject, version: CanvasVersion) => {
        modal.confirm({ title: `恢复“${version.label || "未命名版本"}”？`, content: "当前画布会被版本快照替换，恢复前建议先保存一个新版本。", onOk: async () => {
            const snapshot = await restoreCanvasVersion(project.id, version.id);
            replaceProjects(projects.map((item) => item.id === project.id ? snapshot as unknown as CanvasProject : item));
            message.success("画布已恢复");
        } });
    };

    const share = async (project: CanvasProject) => {
        const created = await createCanvasShare(project.id, "copy");
        const url = `${window.location.origin}/shared/${created.token}`;
        await navigator.clipboard?.writeText(url);
        await loadProjectMeta(project.id);
        message.success("复制分享链接成功");
    };

    const revoke = async (projectId: string, shareId: string) => {
        await deleteCanvasShare(projectId, shareId);
        await loadProjectMeta(projectId);
        message.success("分享链接已撤销");
    };

    return <div className="space-y-4">{projects.length ? projects.map((project) => <Card key={project.id} size="small" title={<span className="inline-flex min-w-0 items-center gap-2"><FolderKanban className="size-4 text-sky-600" /><span className="truncate">{project.title}</span></span>} extra={<div className="flex gap-1"><Tooltip title="保存版本"><Button type="text" size="small" icon={<FileClock className="size-4" />} loading={loading === project.id} onClick={() => void createVersion(project)} aria-label="保存版本" /></Tooltip><Tooltip title="创建分享链接"><Button type="text" size="small" icon={<Share2 className="size-4" />} onClick={() => void share(project)} aria-label="创建分享链接" /></Tooltip></div>}>
        <div className="flex flex-wrap items-center gap-2 text-xs text-stone-500"><Tag>{project.nodes.length} 个节点</Tag><Tag>{project.connections.length} 条连线</Tag><span>更新于 {new Date(project.updatedAt).toLocaleString("zh-CN", { hour12: false })}</span>{teams.length ? <Select size="small" allowClear placeholder="加入团队" options={teams.map((team) => ({ label: team.name, value: team.id }))} onChange={(teamId) => void setCanvasProjectTeam(project.id, teamId || null).then(() => message.success(teamId ? "已加入团队" : "已移出团队"))} /> : null}</div>
        <div className="mt-4 grid gap-4 lg:grid-cols-2"><div><div className="mb-2 flex items-center gap-2 text-sm font-medium"><FileClock className="size-4" />版本历史</div>{versions[project.id]?.length ? <List size="small" dataSource={versions[project.id]} renderItem={(version) => <List.Item actions={[<Button key="restore" type="link" size="small" onClick={() => restore(project, version)}>恢复</Button>]}><List.Item.Meta title={version.label || "未命名版本"} description={new Date(version.createdAt).toLocaleString("zh-CN", { hour12: false })} /></List.Item>} /> : <Button type="link" onClick={() => void loadProjectMeta(project.id)}>加载版本</Button>}</div><div><div className="mb-2 flex items-center gap-2 text-sm font-medium"><Link2 className="size-4" />分享链接</div>{shares[project.id]?.length ? <List size="small" dataSource={shares[project.id]} renderItem={(share) => <List.Item actions={[<Button key="revoke" type="link" danger size="small" onClick={() => void revoke(project.id, share.id)}>撤销</Button>]}><List.Item.Meta title={share.permission === "copy" ? "可复制" : "仅查看"} description={`${window.location.origin}/shared/${share.token}`} /></List.Item>} /> : <Button type="link" onClick={() => void loadProjectMeta(project.id)}>加载分享</Button>}</div></div>
    </Card>) : <Empty description="还没有画布" />}</div>;
}

function TemplateCenter() {
    const { message, modal } = App.useApp();
    const projects = useCanvasStore((state) => state.projects);
    const importProject = useCanvasStore((state) => state.importProject);
    const [items, setItems] = useState<WorkflowTemplate[]>([]);
    const [query, setQuery] = useState("");
    const [loading, setLoading] = useState(true);
    const load = async () => { setLoading(true); setItems(await fetchWorkflowTemplates(query).catch(() => [])); setLoading(false); };
    useEffect(() => { void load(); }, [query]);
    const saveProjectAsTemplate = () => {
        if (!projects.length) { message.warning("先创建一个画布"); return; }
        const project = projects[0];
        modal.confirm({ title: "保存工作流模板", content: <Input id="template-name" defaultValue={project.title} placeholder="模板名称" />, onOk: async () => {
            const name = (document.getElementById("template-name") as HTMLInputElement | null)?.value?.trim() || project.title;
            await createWorkflowTemplate({ name, description: `${project.nodes.length} 个节点的画布工作流`, tags: ["画布"], visibility: "private", data: project as unknown as Record<string, unknown> });
            await load();
            message.success("模板已保存");
        } });
    };
    const applyTemplate = async (item: WorkflowTemplate) => { const data = await fetchTemplateData(item.id); importProject(data as Partial<CanvasProject>); message.success("已复制为新画布"); };
    return <div className="space-y-5"><div className="flex flex-wrap justify-between gap-3"><Input allowClear className="max-w-md" prefix={<Search className="size-4 text-stone-400" />} placeholder="搜索模板" value={query} onChange={(event) => setQuery(event.target.value)} /><Button type="primary" icon={<Plus className="size-4" />} onClick={saveProjectAsTemplate}>保存当前画布为模板</Button></div>{loading ? <div className="grid min-h-64 place-items-center"><Spin /></div> : items.length ? <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{items.map((item) => <Card key={item.id} size="small" title={<span className="truncate">{item.name}</span>} extra={<Tag color={item.visibility === "public" ? "blue" : "default"}>{item.visibility === "public" ? "公开" : "私有"}</Tag>}><p className="min-h-10 text-sm text-stone-500">{item.description || "暂无描述"}</p><div className="mt-3 flex flex-wrap gap-1">{item.tags.map((tag) => <Tag key={tag}>{tag}</Tag>)}</div><div className="mt-4 flex items-center justify-between"><span className="text-xs text-stone-400">使用 {item.uses} 次</span><div className="flex gap-1"><Button size="small" icon={<Copy className="size-3.5" />} onClick={() => void applyTemplate(item)}>复制到画布</Button><Button type="text" danger size="small" icon={<Trash2 className="size-3.5" />} onClick={() => void deleteWorkflowTemplate(item.id).then(load)} aria-label="删除模板" /></div></div></Card>)}</div> : <Empty description="还没有工作流模板" />}</div>;
}

function NotificationCenter() {
    const { message } = App.useApp();
    const [items, setItems] = useState<WorkspaceNotification[]>([]);
    const [unread, setUnread] = useState(0);
    const load = async () => { const data = await fetchNotifications(); setItems(data.items); setUnread(data.unread); };
    useEffect(() => { void load(); }, []);
    const read = async (item: WorkspaceNotification) => { if (item.read) return; await markNotificationRead(item.id); setItems((current) => current.map((entry) => entry.id === item.id ? { ...entry, read: true } : entry)); setUnread((value) => Math.max(0, value - 1)); };
    const readAll = async () => { await markAllNotificationsRead(); setItems((current) => current.map((item) => ({ ...item, read: true }))); setUnread(0); message.success("已全部标记为已读"); };
    return <div className="space-y-4"><div className="flex items-center justify-between"><div className="text-sm text-stone-500">未读 {unread} 条</div><Button icon={<Check className="size-4" />} disabled={!unread} onClick={() => void readAll()}>全部已读</Button></div>{items.length ? <List className="overflow-hidden rounded-lg border border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-950" dataSource={items} renderItem={(item) => <List.Item className={!item.read ? "bg-sky-50/60 dark:bg-sky-950/20" : undefined} onClick={() => void read(item)}><List.Item.Meta avatar={<Avatar icon={<Bell className="size-4" />} />} title={<span className={!item.read ? "font-semibold" : undefined}>{item.title}</span>} description={<span>{item.body}<span className="ml-2 text-xs text-stone-400">{new Date(item.createdAt).toLocaleString("zh-CN", { hour12: false })}</span></span>} /></List.Item>} /> : <Empty description="暂无通知" />}</div>;
}

function TeamCenter() {
    const { message } = App.useApp();
    const [teams, setTeams] = useState<WorkspaceTeam[]>([]);
    const [members, setMembers] = useState<Record<string, WorkspaceTeamMember[]>>({});
    const [newTeam, setNewTeam] = useState("");
    const [inviteEmail, setInviteEmail] = useState("");
    const [activeTeam, setActiveTeam] = useState<string | null>(null);
    const load = async () => setTeams(await fetchTeams());
    useEffect(() => { void load(); }, []);
    const create = async () => { if (!newTeam.trim()) return; await createTeam(newTeam.trim()); setNewTeam(""); await load(); message.success("团队空间已创建"); };
    const openTeam = async (id: string) => { setActiveTeam(id); const nextMembers = await fetchTeamMembers(id); setMembers((current) => ({ ...current, [id]: nextMembers })); };
    const invite = async () => { if (!activeTeam || !inviteEmail.trim()) return; await addTeamMember(activeTeam, inviteEmail.trim()); setInviteEmail(""); await openTeam(activeTeam); message.success("成员已加入团队"); };
    const activeRole = teams.find((team) => team.id === activeTeam)?.role;
    return <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(320px,420px)]"><section className="space-y-3"><div className="flex gap-2"><Input value={newTeam} onChange={(event) => setNewTeam(event.target.value)} placeholder="新团队名称" onPressEnter={() => void create()} /><Button type="primary" icon={<Plus className="size-4" />} onClick={() => void create()}>创建团队</Button></div>{teams.length ? teams.map((team) => <Card key={team.id} size="small" hoverable onClick={() => void openTeam(team.id)} className={activeTeam === team.id ? "border-sky-400" : undefined}><div className="flex items-center justify-between"><div><div className="font-medium">{team.name}</div><div className="mt-1 text-xs text-stone-500">{team.members} 位成员 · {team.role === "owner" ? "所有者" : "协作者"}</div></div><UsersRound className="size-5 text-sky-600" /></div></Card>) : <Empty description="还没有团队空间" />}</section>{activeTeam ? <Card size="small" title="团队成员"><div className="mb-3 flex gap-2"><Input value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} placeholder="已注册用户邮箱" onPressEnter={() => void invite()} /><Button icon={<Plus className="size-4" />} onClick={() => void invite()} aria-label="添加成员" /></div><List size="small" dataSource={members[activeTeam] || []} renderItem={(member) => <List.Item actions={activeRole === "owner" && member.role !== "owner" ? [<Button key="remove" type="text" danger size="small" icon={<Trash2 className="size-3.5" />} onClick={() => void removeTeamMember(activeTeam, member.id).then(() => openTeam(activeTeam))} aria-label="移除成员" />] : undefined}><List.Item.Meta avatar={<Avatar>{(member.displayName || member.email).slice(0, 1).toUpperCase()}</Avatar>} title={member.displayName || member.email} description={member.email} /><Tag>{member.role}</Tag></List.Item>} /></Card> : <Card size="small"><Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="选择一个团队查看成员" /></Card>}</div>;
}

export function SharedCanvasPage() {
    const { token = "" } = useParams<{ token: string }>();
    const { message } = App.useApp();
    const navigate = useNavigate();
    const importProject = useCanvasStore((state) => state.importProject);
    const [shared, setShared] = useState<Awaited<ReturnType<typeof fetchSharedCanvas>> | null>(null);
    const [loading, setLoading] = useState(true);
    useEffect(() => { void fetchSharedCanvas(token).then(setShared).finally(() => setLoading(false)); }, [token]);
    const copy = async () => {
        if (!shared || shared.permission !== "copy") return;
        try {
            const result = await copySharedCanvas(token);
            const id = importProject(result.project as Partial<CanvasProject>);
            message.success("已复制到我的画布");
            navigate(`/canvas/${id}`);
        } catch (error) {
            if ((error as { response?: { status?: number } }).response?.status === 401) navigate(`/login?from=/shared/${encodeURIComponent(token)}`);
            else message.error("复制失败，请先登录");
        }
    };
    if (loading) return <main className="grid min-h-dvh place-items-center"><Spin /></main>;
    if (!shared) return <main className="grid min-h-dvh place-items-center"><Empty description="分享链接不存在或已过期" /></main>;
    const data = shared.project as Partial<CanvasProject>;
    return <main className="min-h-dvh bg-[#f7f7f5] px-5 py-12 text-stone-950 dark:bg-[#0d0d0c] dark:text-stone-100"><Card className="mx-auto max-w-2xl" title={<span className="inline-flex items-center gap-2"><Share2 className="size-4" />{shared.title}</span>}><div className="grid gap-3 sm:grid-cols-3"><Stat label="节点" value={data.nodes?.length || 0} /><Stat label="连线" value={data.connections?.length || 0} /><Stat label="权限" value={shared.permission === "copy" ? "可复制" : "仅查看"} /></div>{shared.permission === "copy" ? <Button type="primary" className="mt-6" icon={<Copy className="size-4" />} onClick={() => void copy()}>复制到我的画布</Button> : null}</Card></main>;
}

function Stat({ label, value }: { label: string; value: string | number }) { return <div className="border-l-2 border-stone-200 pl-3 dark:border-stone-800"><div className="text-xs text-stone-500">{label}</div><div className="mt-1 text-lg font-semibold">{value}</div></div>; }
function localTaskToUnified(item: GenerationTaskItem): UnifiedTask { return { id: item.id, clientKey: `${item.capability}:${item.id}`, capability: item.capability, status: item.status === "completed" ? "done" : item.status, title: item.title, prompt: item.prompt, model: item.model, error: item.error, createdAt: new Date(item.createdAt).toISOString(), updatedAt: new Date(item.createdAt).toISOString(), thumbnails: item.thumbnails, request: item.request, result: item.result, local: true }; }
function resultThumbnails(result?: Record<string, unknown>) { const raw = Array.isArray(result?.thumbnails) ? result.thumbnails : []; return raw.map((item) => String(item)).filter(Boolean); }
function ImagePlusIcon() { return <Sparkles className="size-4" />; }
function VideoIcon() { return <Layers3 className="size-4" />; }

function TaskThumbnail({ value, remote, capability }: { value: string; remote: boolean; capability: UnifiedTask["capability"] }) {
    const [src, setSrc] = useState(value);
    useEffect(() => {
        if (!remote || !value.includes(":")) return;
        let alive = true;
        const request = value.startsWith("image:") ? resolveImageUrl(value, value) : resolveMediaUrl(value, value);
        void request.then((url) => alive && setSrc(url)).catch(() => undefined);
        return () => { alive = false; };
    }, [capability, remote, value]);
    return <img src={src} alt="生成结果" className="aspect-square w-full rounded-md bg-stone-100 object-cover dark:bg-stone-900" />;
}
