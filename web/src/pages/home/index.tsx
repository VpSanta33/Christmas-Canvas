import { ArrowRight, ImagePlus, Sparkles, Video, Workflow } from "lucide-react";
import { Button } from "antd";
import { useNavigate } from "react-router-dom";

const creationEntrances = [
    { number: "01", title: "图片生成", description: "从文字与参考图快速构建视觉", icon: ImagePlus, path: "/image" },
    { number: "02", title: "视频创作", description: "把画面延展成镜头、动作与叙事", icon: Video, path: "/video" },
    { number: "03", title: "无限画布", description: "连接素材、想法与可复用工作流", icon: Workflow, path: "/canvas" },
] as const;

export default function HomePage() {
    const navigate = useNavigate();

    return (
        <main className="h-full overflow-y-auto bg-[#f6f6f3] text-stone-950 dark:bg-[#0d0d0c] dark:text-stone-100">
            <section className="relative overflow-hidden border-b border-stone-200 bg-[#efefeb] dark:border-stone-800 dark:bg-[#11110f]">
                <div className="pointer-events-none absolute -left-40 -top-28 size-[30rem] rounded-full bg-amber-300/15 blur-3xl dark:bg-amber-500/5" />
                <div className="pointer-events-none absolute -right-32 -top-72 size-[42rem] rounded-full border border-stone-300/60 dark:border-white/5" />
                <div className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-amber-500/30 to-transparent" />
                <div className="relative mx-auto max-w-7xl px-5 py-12 sm:px-8 sm:py-16 lg:py-20">
                    <div className="grid gap-12 lg:grid-cols-[minmax(0,1.18fr)_minmax(340px,0.82fr)] lg:items-end lg:gap-20">
                        <div className="max-w-3xl">
                            <div className="mb-4 inline-flex items-center gap-2 text-xs font-semibold tracking-[0.14em] text-amber-600 dark:text-amber-400">
                                <Sparkles className="size-3.5" />
                                ABOUT SANTA CANVAS
                            </div>
                            <h1 className="text-4xl font-semibold leading-[1.06] tracking-[-0.04em] sm:text-5xl lg:text-6xl">
                                让一个想法，
                                <span className="block">长成一件作品。</span>
                            </h1>
                            <p className="mt-6 max-w-2xl text-base leading-8 text-stone-500 dark:text-stone-400">圣诞画布把 AI 图片、视频和无限画布连接在一起。你可以从一次生成开始，把素材、思路与步骤沉淀为可复用的工作流，再把作品分享给社区。</p>
                            <div className="mt-8 flex flex-wrap gap-3">
                                <Button type="primary" size="large" icon={<ArrowRight className="size-4" />} iconPlacement="end" onClick={() => navigate("/canvas")}>
                                    开始创作
                                </Button>
                            </div>
                        </div>
                        <div className="lg:pl-2">
                            <div className="flex items-center justify-between text-[11px] font-semibold tracking-[0.14em] text-stone-400">
                                <span>THREE WAYS TO CREATE</span>
                                <span>01 — 03</span>
                            </div>
                            <div className="mt-4 border-t border-stone-300 dark:border-stone-700">
                                {creationEntrances.map(({ number, title, description, icon: Icon, path }) => (
                                    <button
                                        key={path}
                                        type="button"
                                        onClick={() => navigate(path)}
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
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>
            </section>
        </main>
    );
}
