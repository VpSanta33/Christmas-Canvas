import { ArrowRight, ArrowUpRight, CalendarDays, Check, Clapperboard, ImagePlus, Layers3, LogIn, Maximize2, Plus, Sparkles, Video, Workflow } from "lucide-react";
import { Button } from "antd";
import { motion, useReducedMotion } from "motion/react";
import { useNavigate } from "react-router-dom";

import { isBackendMode } from "@/constant/runtime-config";
import { normalizeCanvasProjects, useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { useAuthStore } from "@/stores/use-auth-store";

const studioModes = [
    { number: "01", title: "图片生成", detail: "构建视觉", icon: ImagePlus, path: "/image", accent: "text-sky-500" },
    { number: "02", title: "视频创作", detail: "延展镜头", icon: Video, path: "/video", accent: "text-violet-500" },
    { number: "03", title: "无限画布", detail: "编排工作流", icon: Workflow, path: "/canvas", accent: "text-amber-500" },
    { number: "04", title: "导演台", detail: "组织场景", icon: Clapperboard, path: "/director", accent: "text-emerald-500" },
] as const;

const workflowSteps = [
    { number: "01", title: "捕捉", detail: "一句话、一张参考图，或者一个镜头。" },
    { number: "02", title: "编排", detail: "把素材、节点和生成结果放到同一张画布。" },
    { number: "03", title: "沉淀", detail: "保存版本和任务，让下一次创作接着走。" },
] as const;

const projectDateFormatter = new Intl.DateTimeFormat("zh-CN", { month: "short", day: "numeric" });

const reveal = {
    hidden: { opacity: 0, y: 18 },
    visible: { opacity: 1, y: 0, transition: { duration: 0.55, ease: "easeOut" } },
};

const staticReveal = {
    hidden: { opacity: 1, y: 0 },
    visible: { opacity: 1, y: 0 },
};

function formatProjectDate(value: string) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "未知时间" : projectDateFormatter.format(date);
}

export default function HomePage() {
    const navigate = useNavigate();
    const reduceMotion = useReducedMotion();
    const backendMode = isBackendMode();
    const token = useAuthStore((state) => state.token);
    const hydrated = useCanvasStore((state) => state.hydrated);
    const projects = useCanvasStore((state) => state.projects);
    const canViewPrivateWorkspace = !backendMode || Boolean(token);
    const validProjects = canViewPrivateWorkspace ? normalizeCanvasProjects(projects) : [];
    const recentProjects = validProjects.slice(0, 3);
    const enterMotion = reduceMotion ? staticReveal : reveal;

    return (
        <motion.main initial="hidden" animate="visible" variants={enterMotion} className="h-full overflow-y-auto bg-[#f5f4f0] text-stone-950 dark:bg-[#0b0b0a] dark:text-stone-100">
            <section className="relative overflow-hidden border-b border-stone-300 bg-[#f5f4f0] dark:border-stone-800 dark:bg-[#0b0b0a]">
                <div className="pointer-events-none absolute inset-y-0 left-[8%] w-px bg-stone-900/10 dark:bg-white/10" />
                <div className="pointer-events-none absolute inset-y-0 right-[8%] w-px bg-stone-900/10 dark:bg-white/10" />
                <div className="pointer-events-none absolute left-[8%] right-[8%] top-20 h-px bg-stone-900/10 dark:bg-white/10" />
                {!reduceMotion ? <motion.div className="pointer-events-none absolute left-[8%] top-20 h-px w-28 origin-left bg-amber-500" animate={{ scaleX: [0.25, 1, 0.4], opacity: [0.3, 1, 0.3] }} transition={{ duration: 4.8, repeat: Infinity, ease: "easeInOut" }} /> : null}

                <div className="relative mx-auto max-w-[1440px] px-5 pb-14 pt-10 sm:px-8 sm:pb-20 sm:pt-14 lg:px-12 lg:pb-24 lg:pt-16">
                    <div className="grid items-center gap-14 lg:grid-cols-[minmax(0,0.95fr)_minmax(500px,1.05fr)] lg:gap-20">
                        <motion.div variants={enterMotion} className="max-w-2xl">
                            <div className="mb-6 flex items-center gap-3 text-[11px] font-semibold tracking-[0.18em] text-amber-600 dark:text-amber-400">
                                <span className="grid size-6 place-items-center border border-amber-500/50">
                                    <Sparkles className="size-3.5" />
                                </span>
                                SANTA CANVAS / CREATIVE OS
                            </div>
                            <h1 className="max-w-xl text-5xl font-semibold leading-[0.98] sm:text-6xl lg:text-7xl">
                                让灵感，
                                <span className="mt-2 block text-stone-500 dark:text-stone-400">拥有自己的轨道。</span>
                            </h1>
                            <p className="mt-7 max-w-lg text-base leading-8 text-stone-500 dark:text-stone-400">从图片、视频到镜头编排，把每个创作决定放在可继续、可复用的工作流里。你的模型，你的 API，你的作品。</p>
                            <div className="mt-9 flex flex-wrap items-center gap-3">
                                <Button type="primary" size="large" icon={<ArrowRight className="size-4" />} iconPlacement="end" onClick={() => navigate("/canvas?mode=new")}>
                                    新建画布
                                </Button>
                                <Button size="large" icon={<Layers3 className="size-4" />} onClick={() => navigate("/workspace")}>
                                    打开工作空间
                                </Button>
                            </div>
                            <div className="mt-10 flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-stone-300 pt-4 text-[11px] text-stone-500 dark:border-stone-700 dark:text-stone-400">
                                <span className="inline-flex items-center gap-2"><span className="size-1.5 bg-emerald-500" />BROWSER-FIRST</span>
                                <span className="inline-flex items-center gap-2"><span className="size-1.5 bg-sky-500" />BYOK WORKFLOW</span>
                                <span className="inline-flex items-center gap-2"><span className="size-1.5 bg-amber-500" />LOCAL CONTROL</span>
                            </div>
                        </motion.div>

                        <motion.div variants={enterMotion} transition={{ delay: 0.12 }} className="relative">
                            <div className="mb-3 flex items-center justify-between text-[10px] font-semibold tracking-[0.18em] text-stone-400">
                                <span>START BOARD / 001</span>
                                <span className="inline-flex items-center gap-2"><span className="size-1.5 bg-emerald-500" />READY</span>
                            </div>
                            <div className="relative min-h-[360px] overflow-hidden border border-stone-800 bg-[#151515] shadow-[18px_18px_0_rgba(28,25,23,0.08)] dark:border-stone-700 dark:shadow-[18px_18px_0_rgba(0,0,0,0.28)] sm:min-h-[430px]">
                                <div className="pointer-events-none absolute inset-0 opacity-40">
                                    {Array.from({ length: 7 }, (_, index) => <span key={`v-${index}`} className="absolute inset-y-0 w-px bg-white/10" style={{ left: `${14 + index * 14}%` }} />)}
                                    {Array.from({ length: 5 }, (_, index) => <span key={`h-${index}`} className="absolute inset-x-0 h-px bg-white/10" style={{ top: `${18 + index * 16}%` }} />)}
                                </div>
                                <div className="relative flex items-center justify-between border-b border-white/10 px-5 py-4 text-[10px] tracking-[0.14em] text-stone-400">
                                    <span className="inline-flex items-center gap-2"><Maximize2 className="size-3.5" />INFINITE CANVAS</span>
                                    <span>01 / 04</span>
                                </div>
                                <div className="absolute left-[13%] top-[29%] w-32 border border-white/15 bg-[#1d1d1d] p-3 text-white shadow-xl sm:w-40">
                                    <div className="flex items-center justify-between text-[9px] tracking-[0.12em] text-stone-500"><span>PROMPT</span><span className="text-amber-400">TEXT</span></div>
                                    <div className="mt-4 h-1 w-16 bg-white/70" />
                                    <div className="mt-2 h-1 w-24 bg-white/20" />
                                    <div className="mt-2 h-1 w-20 bg-white/20" />
                                </div>
                                <div className="absolute left-[43%] top-[47%] h-px w-[18%] bg-amber-400/70" />
                                <div className="absolute left-[61%] top-[47%] size-1.5 -translate-y-1/2 bg-amber-400" />
                                <div className="absolute right-[10%] top-[32%] w-32 border border-sky-400/35 bg-[#17222a] p-3 text-white shadow-xl sm:w-40">
                                    <div className="flex items-center justify-between text-[9px] tracking-[0.12em] text-stone-400"><span>OUTPUT</span><span className="text-sky-300">IMAGE</span></div>
                                    <div className="mt-4 grid aspect-[1.55] place-items-center border border-white/10 bg-[linear-gradient(135deg,rgba(14,165,233,0.25),rgba(245,158,11,0.16))]">
                                        <ImagePlus className="size-5 text-white/70" />
                                    </div>
                                </div>
                                <motion.button type="button" onClick={() => navigate("/canvas?mode=new")} whileHover={reduceMotion ? undefined : { scale: 1.03 }} whileTap={reduceMotion ? undefined : { scale: 0.98 }} className="absolute bottom-[13%] left-1/2 -translate-x-1/2 border border-amber-400/70 bg-amber-400 px-4 py-3 text-left text-stone-950 shadow-[0_0_0_5px_rgba(245,158,11,0.08)]">
                                    <span className="block text-[10px] font-semibold tracking-[0.14em]">BEGIN WITH A BOARD</span>
                                    <span className="mt-1 block text-xs text-stone-800">点击创建第一张画布 <ArrowUpRight className="ml-1 inline size-3.5" /></span>
                                </motion.button>
                                <div className="absolute bottom-4 left-5 right-5 flex items-center justify-between text-[9px] tracking-[0.12em] text-stone-500">
                                    <span>PERSONAL API / CONNECTED BY YOU</span>
                                    <span>ZOOM 100%</span>
                                </div>
                            </div>
                        </motion.div>
                    </div>
                </div>
            </section>

            <section className="border-b border-stone-300 bg-white dark:border-stone-800 dark:bg-[#11110f]">
                <div className="mx-auto max-w-[1440px] px-5 py-12 sm:px-8 sm:py-16 lg:px-12">
                    <div className="flex flex-wrap items-end justify-between gap-5 border-b border-stone-200 pb-5 dark:border-stone-800">
                        <div>
                            <div className="text-[10px] font-semibold tracking-[0.18em] text-amber-600 dark:text-amber-400">THE STUDIO / 04 MODES</div>
                            <h2 className="mt-3 text-3xl font-semibold sm:text-4xl">选择你的工作方式。</h2>
                        </div>
                        <span className="max-w-xs text-right text-xs leading-5 text-stone-500 dark:text-stone-400">每个入口都可以独立开始，也可以在画布中组合成完整流程。</span>
                    </div>
                    <div className="grid border-l border-stone-200 sm:grid-cols-2 lg:grid-cols-4 dark:border-stone-800">
                        {studioModes.map(({ number, title, detail, icon: Icon, path, accent }) => (
                            <motion.button key={path} type="button" onClick={() => navigate(path)} whileHover={reduceMotion ? undefined : { y: -5 }} whileTap={reduceMotion ? undefined : { scale: 0.985 }} className="group min-h-44 border-b border-r border-stone-200 px-5 py-5 text-left transition hover:bg-stone-50 dark:border-stone-800 dark:hover:bg-white/[0.03]">
                                <div className="flex items-start justify-between">
                                    <span className="font-mono text-[11px] text-stone-400">{number}</span>
                                    <Icon className={`size-5 ${accent} transition-transform duration-300 group-hover:rotate-[-8deg]`} />
                                </div>
                                <div className="mt-12 flex items-end justify-between gap-3">
                                    <span><span className="block text-sm font-semibold">{title}</span><span className="mt-1 block text-xs text-stone-500 dark:text-stone-400">{detail}</span></span>
                                    <ArrowUpRight className="size-4 shrink-0 text-stone-300 transition group-hover:-translate-y-1 group-hover:translate-x-1 group-hover:text-stone-900 dark:text-stone-600 dark:group-hover:text-white" />
                                </div>
                            </motion.button>
                        ))}
                    </div>
                </div>
            </section>

            <section className="border-b border-stone-300 bg-[#f5f4f0] dark:border-stone-800 dark:bg-[#0b0b0a]">
                <div className="mx-auto grid max-w-[1440px] gap-12 px-5 py-12 sm:px-8 sm:py-16 lg:grid-cols-[0.72fr_1.28fr] lg:gap-20 lg:px-12">
                    <div>
                        <div className="text-[10px] font-semibold tracking-[0.18em] text-stone-400">YOUR WORKSPACE</div>
                        <h2 className="mt-3 text-3xl font-semibold sm:text-4xl">最近项目。</h2>
                        <p className="mt-4 max-w-sm text-sm leading-7 text-stone-500 dark:text-stone-400">把正在进行的想法放回手边。项目只在当前账号登录后显示。</p>
                        <Button type="text" icon={<ArrowRight className="size-4" />} iconPlacement="end" className="mt-5 !px-0" onClick={() => navigate("/canvas")}>
                            打开画布库
                        </Button>
                    </div>
                    <div className="min-w-0 border-t border-stone-300 dark:border-stone-700">
                        {!canViewPrivateWorkspace ? (
                            <div className="flex min-h-48 flex-col items-center justify-center border-b border-stone-300 text-center dark:border-stone-700">
                                <LogIn className="size-5 text-stone-400" />
                                <h3 className="mt-3 text-sm font-semibold">登录后查看最近项目</h3>
                                <p className="mt-1 text-xs text-stone-500 dark:text-stone-400">你的画布只对当前账号可见。</p>
                                <Button type="primary" size="small" className="mt-4" icon={<LogIn className="size-3.5" />} onClick={() => navigate("/login?from=/")}>
                                    登录
                                </Button>
                            </div>
                        ) : !hydrated ? (
                            <div className="flex min-h-48 items-center justify-center text-sm text-stone-400">正在读取本地项目...</div>
                        ) : recentProjects.length ? (
                            recentProjects.map((project, index) => (
                                <motion.button key={project.id} type="button" onClick={() => navigate(`/canvas/${project.id}`)} whileHover={reduceMotion ? undefined : { x: 6 }} className="group flex w-full items-center gap-4 border-b border-stone-300 py-5 text-left transition dark:border-stone-700">
                                    <span className="grid size-10 shrink-0 place-items-center border border-stone-300 bg-white text-stone-500 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-400">{index === 0 ? <Maximize2 className="size-4" /> : <Workflow className="size-4" />}</span>
                                    <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{project.title}</span><span className="mt-1 inline-flex items-center gap-1.5 text-xs text-stone-400"><CalendarDays className="size-3.5" />更新于 {formatProjectDate(project.updatedAt)}</span></span>
                                    <ArrowUpRight className="size-4 shrink-0 text-stone-300 transition group-hover:-translate-y-1 group-hover:translate-x-1 group-hover:text-stone-900 dark:text-stone-600 dark:group-hover:text-white" />
                                </motion.button>
                            ))
                        ) : (
                            <div className="flex min-h-48 flex-col items-center justify-center border-b border-dashed border-stone-300 text-center dark:border-stone-700">
                                <Maximize2 className="size-5 text-stone-400" />
                                <h3 className="mt-3 text-sm font-semibold">还没有最近项目</h3>
                                <p className="mt-1 text-xs text-stone-500 dark:text-stone-400">新建画布后，项目会出现在这里。</p>
                                <Button type="primary" size="small" className="mt-4" icon={<Plus className="size-3.5" />} onClick={() => navigate("/canvas?mode=new")}>新建画布</Button>
                            </div>
                        )}
                    </div>
                </div>
            </section>

            <section className="bg-stone-950 text-stone-100 dark:bg-[#151514]">
                <div className="mx-auto grid max-w-[1440px] gap-10 px-5 py-12 sm:px-8 sm:py-16 lg:grid-cols-[0.72fr_1.28fr] lg:gap-20 lg:px-12">
                    <div>
                        <div className="text-[10px] font-semibold tracking-[0.18em] text-amber-400">A SIMPLE RHYTHM</div>
                        <h2 className="mt-3 text-3xl font-semibold sm:text-4xl">让过程，留下来。</h2>
                    </div>
                    <div className="grid border-l border-white/15 sm:grid-cols-3">
                        {workflowSteps.map(({ number, title, detail }) => (
                            <div key={number} className="border-b border-r border-white/15 px-5 py-5 sm:border-t-0">
                                <span className="font-mono text-[11px] text-amber-400">{number}</span>
                                <div className="mt-12 flex items-center gap-2 text-sm font-semibold"><Check className="size-4 text-emerald-400" />{title}</div>
                                <p className="mt-2 text-xs leading-6 text-stone-400">{detail}</p>
                            </div>
                        ))}
                    </div>
                </div>
            </section>
        </motion.main>
    );
}
