import { ArrowRight, ArrowUpRight, CalendarDays, Clapperboard, ImagePlus, Layers3, ListTodo, Maximize2, Plus, Sparkles, Video, Workflow } from "lucide-react";
import { Button } from "antd";
import { motion, useReducedMotion } from "motion/react";
import { useNavigate } from "react-router-dom";

import { normalizeCanvasProjects, useCanvasStore } from "@/stores/canvas/use-canvas-store";

const creationEntrances = [
    { number: "01", title: "图片生成", description: "从文字与参考图快速构建视觉", icon: ImagePlus, path: "/image" },
    { number: "02", title: "视频创作", description: "把画面延展成镜头、动作与叙事", icon: Video, path: "/video" },
    { number: "03", title: "无限画布", description: "连接素材、想法与可复用工作流", icon: Workflow, path: "/canvas" },
    { number: "04", title: "导演台", description: "拆解镜头、组织场景与拍摄计划", icon: Clapperboard, path: "/director" },
] as const;

const quickActions = [
    { title: "新建空白画布", description: "从一张空白工作区开始", icon: Plus, path: "/canvas?mode=new" },
    { title: "继续最近项目", description: "回到上次停下的位置", icon: Maximize2, path: "/canvas?mode=recent" },
    { title: "查看任务中心", description: "检查生成状态与历史结果", icon: ListTodo, path: "/tasks" },
    { title: "打开工作空间", description: "管理版本、模板与团队项目", icon: Layers3, path: "/workspace" },
] as const;

const projectDateFormatter = new Intl.DateTimeFormat("zh-CN", { month: "short", day: "numeric" });

const revealVariants = {
    hidden: { opacity: 0, y: 22 },
    visible: { opacity: 1, y: 0, transition: { duration: 0.55, ease: "easeOut" } },
};

const staticRevealVariants = {
    hidden: { opacity: 1, y: 0 },
    visible: { opacity: 1, y: 0 },
};

const listVariants = {
    hidden: { opacity: 1 },
    visible: { opacity: 1, transition: { delayChildren: 0.12, staggerChildren: 0.08 } },
};

const itemVariants = {
    hidden: { opacity: 0, x: 18 },
    visible: { opacity: 1, x: 0, transition: { duration: 0.4, ease: "easeOut" } },
};

const staticItemVariants = {
    hidden: { opacity: 1, x: 0 },
    visible: { opacity: 1, x: 0 },
};

function formatProjectDate(value: string) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "未知时间" : projectDateFormatter.format(date);
}

export default function HomePage() {
    const navigate = useNavigate();
    const reduceMotion = useReducedMotion();
    const hydrated = useCanvasStore((state) => state.hydrated);
    const projects = useCanvasStore((state) => state.projects);
    const validProjects = normalizeCanvasProjects(projects);
    const recentProjects = validProjects.slice(0, 3);
    const reveal = reduceMotion ? staticRevealVariants : revealVariants;
    const item = reduceMotion ? staticItemVariants : itemVariants;

    return (
        <motion.main initial="hidden" animate="visible" variants={reveal} className="h-full overflow-y-auto bg-[#f6f6f3] text-stone-950 dark:bg-[#0d0d0c] dark:text-stone-100">
            <section className="relative overflow-hidden border-b border-stone-200 bg-[#efefeb] dark:border-stone-800 dark:bg-[#11110f]">
                <div className="pointer-events-none absolute inset-0 opacity-60 [background-image:linear-gradient(to_right,rgba(120,113,108,0.08)_1px,transparent_1px),linear-gradient(to_bottom,rgba(120,113,108,0.08)_1px,transparent_1px)] [background-size:56px_56px] dark:opacity-20" />
                <div className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-amber-500/30" />
                {!reduceMotion ? <motion.div className="pointer-events-none absolute left-[14%] top-0 h-28 w-px origin-top bg-amber-500/60" animate={{ scaleY: [0.25, 1, 0.4], opacity: [0.25, 0.8, 0.25] }} transition={{ duration: 4.8, repeat: Infinity, ease: "easeInOut" }} /> : null}
                <div className="relative mx-auto max-w-7xl px-5 py-12 sm:px-8 sm:py-16 lg:py-20">
                    <div className="grid gap-12 lg:grid-cols-[minmax(0,1.18fr)_minmax(340px,0.82fr)] lg:items-end lg:gap-20">
                        <motion.div variants={reveal} className="max-w-3xl">
                            <div className="mb-4 inline-flex items-center gap-2 text-xs font-semibold tracking-[0.14em] text-amber-600 dark:text-amber-400">
                                <Sparkles className="size-3.5" />
                                SANTA CANVAS / START
                            </div>
                            <h1 className="text-4xl font-semibold leading-[1.06] sm:text-5xl lg:text-6xl">
                                让一个想法，
                                <span className="block">长成一件作品。</span>
                            </h1>
                            <p className="mt-6 max-w-2xl text-base leading-8 text-stone-500 dark:text-stone-400">从一次生成开始，把素材、镜头和思路放在同一个工作流里。模型接口由你配置，创作过程由你掌控。</p>
                            <div className="mt-8 flex flex-wrap gap-3">
                                <Button type="primary" size="large" icon={<ArrowRight className="size-4" />} iconPlacement="end" onClick={() => navigate("/canvas?mode=new")}>
                                    开始创作
                                </Button>
                                <Button size="large" icon={<Maximize2 className="size-4" />} onClick={() => navigate("/canvas?mode=recent")}>
                                    继续项目
                                </Button>
                            </div>
                        </motion.div>
                        <motion.div variants={reveal} transition={{ delay: 0.12 }} className="lg:pl-2">
                            <div className="flex items-center justify-between text-[11px] font-semibold tracking-[0.14em] text-stone-400">
                                <span>FOUR WAYS TO CREATE</span>
                                <span>01 — 04</span>
                            </div>
                            <motion.div variants={listVariants} initial="hidden" animate="visible" className="mt-4 border-t border-stone-300 dark:border-stone-700">
                                {creationEntrances.map(({ number, title, description, icon: Icon, path }) => (
                                    <motion.button
                                        variants={item}
                                        key={path}
                                        type="button"
                                        onClick={() => navigate(path)}
                                        whileHover={reduceMotion ? undefined : { x: 5 }}
                                        whileTap={reduceMotion ? undefined : { scale: 0.99 }}
                                        className="group grid w-full grid-cols-[2rem_1fr_auto] items-center gap-3 border-b border-stone-300 py-4 text-left transition hover:border-stone-400 hover:bg-white/35 hover:px-3 dark:border-stone-700 dark:hover:border-stone-500 dark:hover:bg-white/[0.03]"
                                    >
                                        <span className="font-mono text-[11px] text-amber-600 dark:text-amber-400">{number}</span>
                                        <span className="min-w-0">
                                            <span className="block text-sm font-semibold">{title}</span>
                                            <span className="mt-1 block text-xs leading-5 text-stone-500 dark:text-stone-400">{description}</span>
                                        </span>
                                        <span className="grid size-9 place-items-center rounded-full border border-stone-300 bg-white/60 text-stone-600 transition group-hover:-rotate-6 group-hover:border-stone-900 group-hover:bg-stone-900 group-hover:text-white dark:border-stone-700 dark:bg-white/5 dark:text-stone-300 dark:group-hover:border-white dark:group-hover:bg-white dark:group-hover:text-stone-950">
                                            <Icon className="size-4" />
                                        </span>
                                    </motion.button>
                                ))}
                            </motion.div>
                        </motion.div>
                    </div>
                </div>
            </section>

            <motion.section variants={reveal} initial="hidden" whileInView="visible" viewport={{ once: true, amount: 0.2 }} className="border-b border-stone-200 bg-[#f6f6f3] dark:border-stone-800 dark:bg-[#0d0d0c]">
                <div className="mx-auto max-w-7xl px-5 py-12 sm:px-8 sm:py-14">
                    <div className="grid gap-8 lg:grid-cols-[minmax(220px,0.7fr)_minmax(0,1.3fr)] lg:items-start lg:gap-16">
                        <div>
                            <div className="text-xs font-semibold tracking-[0.14em] text-amber-600 dark:text-amber-400">GET MOVING</div>
                            <h2 className="mt-3 text-2xl font-semibold sm:text-3xl">现在开始，下一步很清楚。</h2>
                            <p className="mt-3 max-w-sm text-sm leading-7 text-stone-500 dark:text-stone-400">把常用入口放在手边。你可以先做一张图，也可以直接搭建完整的镜头工作流。</p>
                        </div>
                        <div className="grid border-l border-stone-300 dark:border-stone-700 sm:grid-cols-2">
                            {quickActions.map(({ title, description, icon: Icon, path }) => (
                                <motion.button
                                    key={path}
                                    type="button"
                                    onClick={() => navigate(path)}
                                    whileHover={reduceMotion ? undefined : { y: -4 }}
                                    whileTap={reduceMotion ? undefined : { scale: 0.985 }}
                                    className="group flex min-h-32 items-start justify-between gap-4 border-b border-r border-t border-stone-300 px-5 py-5 text-left transition first:border-t-0 hover:bg-white/55 sm:min-h-36 sm:even:border-t-0 dark:border-stone-700 dark:hover:bg-white/[0.03]"
                                >
                                    <span>
                                        <span className="grid size-8 place-items-center border border-stone-300 bg-white/60 text-stone-700 dark:border-stone-700 dark:bg-white/5 dark:text-stone-300">
                                            <Icon className="size-4" />
                                        </span>
                                        <span className="mt-4 block text-sm font-semibold">{title}</span>
                                        <span className="mt-1 block text-xs leading-5 text-stone-500 dark:text-stone-400">{description}</span>
                                    </span>
                                    <ArrowUpRight className="mt-1 size-4 shrink-0 text-stone-400 transition group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-stone-950 dark:group-hover:text-white" />
                                </motion.button>
                            ))}
                        </div>
                    </div>
                </div>
            </motion.section>

            <motion.section variants={reveal} initial="hidden" whileInView="visible" viewport={{ once: true, amount: 0.16 }} className="border-b border-stone-200 bg-white dark:border-stone-800 dark:bg-[#11110f]">
                <div className="mx-auto max-w-7xl px-5 py-12 sm:px-8 sm:py-14">
                    <div className="flex flex-wrap items-end justify-between gap-4 border-b border-stone-200 pb-5 dark:border-stone-800">
                        <div>
                            <div className="text-xs font-semibold tracking-[0.14em] text-stone-400">YOUR WORKSPACE</div>
                            <h2 className="mt-3 text-2xl font-semibold sm:text-3xl">最近项目</h2>
                        </div>
                        <div className="flex items-center gap-4">
                            <span className="text-xs text-stone-400">{hydrated ? `${validProjects.length} 个画布` : "正在读取"}</span>
                            <Button type="text" icon={<ArrowRight className="size-4" />} iconPlacement="end" onClick={() => navigate("/canvas")}>
                                打开画布库
                            </Button>
                        </div>
                    </div>
                    {!hydrated ? (
                        <div className="flex min-h-40 items-center justify-center text-sm text-stone-400">正在读取本地项目...</div>
                    ) : recentProjects.length ? (
                        <div className="divide-y divide-stone-200 dark:divide-stone-800">
                            {recentProjects.map((project, index) => (
                                <motion.button
                                    key={project.id}
                                    type="button"
                                    onClick={() => navigate(`/canvas/${project.id}`)}
                                    whileHover={reduceMotion ? undefined : { x: 5 }}
                                    className="group flex w-full items-center gap-4 py-5 text-left transition hover:px-3 hover:bg-stone-50 dark:hover:bg-white/[0.03]"
                                >
                                    <span className="grid size-10 shrink-0 place-items-center border border-stone-200 bg-stone-50 text-stone-500 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-400">
                                        {index === 0 ? <Maximize2 className="size-4" /> : <Workflow className="size-4" />}
                                    </span>
                                    <span className="min-w-0 flex-1">
                                        <span className="block truncate text-sm font-medium text-stone-900 dark:text-stone-100">{project.title}</span>
                                        <span className="mt-1 flex items-center gap-1.5 text-xs text-stone-400">
                                            <CalendarDays className="size-3.5" />
                                            更新于 {formatProjectDate(project.updatedAt)}
                                        </span>
                                    </span>
                                    <ArrowUpRight className="size-4 shrink-0 text-stone-300 transition group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-stone-900 dark:text-stone-600 dark:group-hover:text-stone-100" />
                                </motion.button>
                            ))}
                        </div>
                    ) : (
                        <div className="flex min-h-40 flex-col items-center justify-center border-b border-dashed border-stone-300 text-center dark:border-stone-700">
                            <Maximize2 className="size-5 text-stone-400" />
                            <h3 className="mt-3 text-sm font-semibold">还没有最近项目</h3>
                            <p className="mt-1 text-xs text-stone-500 dark:text-stone-400">新建画布后，项目会出现在这里。</p>
                            <Button type="primary" size="small" className="mt-4" icon={<Plus className="size-3.5" />} onClick={() => navigate("/canvas?mode=new")}>
                                新建画布
                            </Button>
                        </div>
                    )}
                </div>
            </motion.section>

            <motion.section variants={reveal} initial="hidden" whileInView="visible" viewport={{ once: true, amount: 0.16 }} className="bg-[#efefeb] dark:bg-[#11110f]">
                <div className="mx-auto max-w-7xl px-5 py-12 sm:px-8 sm:py-14">
                    <div className="grid gap-8 lg:grid-cols-[0.7fr_1.3fr] lg:gap-16">
                        <div>
                            <div className="text-xs font-semibold tracking-[0.14em] text-amber-600 dark:text-amber-400">A SIMPLE RHYTHM</div>
                            <h2 className="mt-3 text-2xl font-semibold sm:text-3xl">从灵感到成片，保留每一步。</h2>
                        </div>
                        <div className="grid gap-0 border-l border-stone-300 sm:grid-cols-3 dark:border-stone-700">
                            {[
                                { number: "01", title: "捕捉", description: "先把一句话、一张参考图或一个镜头留下来。" },
                                { number: "02", title: "编排", description: "在画布与导演台里连接素材、场景和生成结果。" },
                                { number: "03", title: "沉淀", description: "保存版本、任务与媒体，让下一次创作接着走。" },
                            ].map(({ number, title, description }) => (
                                <motion.div key={number} variants={item} className="border-b border-r border-t border-stone-300 px-5 py-5 first:border-t-0 sm:border-t-0 dark:border-stone-700">
                                    <span className="font-mono text-[11px] text-amber-600 dark:text-amber-400">{number}</span>
                                    <h3 className="mt-5 text-sm font-semibold">{title}</h3>
                                    <p className="mt-2 text-xs leading-6 text-stone-500 dark:text-stone-400">{description}</p>
                                </motion.div>
                            ))}
                        </div>
                    </div>
                </div>
            </motion.section>
        </motion.main>
    );
}
