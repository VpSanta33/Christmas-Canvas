import { Home, RefreshCw, TriangleAlert } from "lucide-react";
import { Link, useRouteError } from "react-router-dom";

export default function RouteErrorPage() {
    const error = useRouteError();
    const detail = error instanceof Error ? error.message : "页面加载时发生了未知错误";

    return (
        <main className="flex min-h-dvh items-center justify-center bg-[#f6f6f3] px-6 py-10 text-stone-950 dark:bg-[#0d0d0c] dark:text-stone-100">
            <section className="w-full max-w-lg border-y border-stone-300 py-10 text-center dark:border-stone-700">
                <span className="mx-auto grid size-12 place-items-center border border-red-200 bg-red-50 text-red-600 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-400">
                    <TriangleAlert className="size-5" />
                </span>
                <h1 className="mt-5 text-2xl font-semibold">页面暂时无法显示</h1>
                <p className="mt-3 text-sm leading-6 text-stone-500 dark:text-stone-400">刷新页面通常可以恢复。你的本地画布数据不会因此被删除。</p>
                <p className="mx-auto mt-4 max-w-md break-words font-mono text-xs text-red-600/80 dark:text-red-400/80">{detail}</p>
                <div className="mt-7 flex flex-wrap justify-center gap-3">
                    <button type="button" className="inline-flex h-10 items-center gap-2 bg-stone-950 px-4 text-sm font-medium text-white transition hover:bg-stone-800 dark:bg-stone-100 dark:text-stone-950 dark:hover:bg-white" onClick={() => window.location.reload()}>
                        <RefreshCw className="size-4" />
                        重新加载
                    </button>
                    <Link to="/" className="inline-flex h-10 items-center gap-2 border border-stone-300 bg-white px-4 text-sm font-medium text-stone-700 transition hover:border-stone-400 hover:text-stone-950 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-300 dark:hover:border-stone-600 dark:hover:text-white">
                        <Home className="size-4" />
                        返回首页
                    </Link>
                </div>
            </section>
        </main>
    );
}
