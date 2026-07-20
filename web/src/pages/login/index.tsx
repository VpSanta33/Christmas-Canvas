import { useEffect, useState } from "react";
import { App, Button, Form, Input } from "antd";
import { ArrowLeft, ArrowRight, Check, ImagePlus, LockKeyhole, Mail, MailCheck, RefreshCw, ShieldCheck, Sparkles, UserRound, Workflow } from "lucide-react";
import { Navigate, useNavigate, useSearchParams } from "react-router-dom";

import { AnimatedThemeToggler } from "@/components/ui/animated-theme-toggler";
import { isBackendMode } from "@/constant/runtime-config";
import { login, register, resendVerification, verifyEmail, type AuthSession } from "@/services/api/auth";
import { useAuthStore } from "@/stores/use-auth-store";
import { useThemeStore } from "@/stores/use-theme-store";
import { extractErrorCode, extractErrorMessage } from "@/utils/http-error";
import { cn } from "@/lib/utils";
import { usePlatformStore } from "@/stores/use-platform-store";

type FormValues = { email: string; password: string; displayName?: string };

export default function LoginPage() {
    const { message } = App.useApp();
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const [submitting, setSubmitting] = useState(false);
    const [mode, setMode] = useState<"login" | "register">("login");
    const [verificationEmail, setVerificationEmail] = useState("");
    const [challengeToken, setChallengeToken] = useState("");
    const [verificationCode, setVerificationCode] = useState("");
    const [verifying, setVerifying] = useState(false);
    const [resending, setResending] = useState(false);
    const [resendCountdown, setResendCountdown] = useState(0);
    const [verificationExpiresIn, setVerificationExpiresIn] = useState(600);
    const token = useAuthStore((state) => state.token);
    const setSession = useAuthStore((state) => state.setSession);
    const theme = useThemeStore((state) => state.theme);
    const setTheme = useThemeStore((state) => state.setTheme);
    const platform = usePlatformStore((state) => state.settings);

    useEffect(() => {
        if (resendCountdown <= 0) return undefined;
        const timer = window.setTimeout(() => setResendCountdown((current) => Math.max(0, current - 1)), 1000);
        return () => window.clearTimeout(timer);
    }, [resendCountdown]);

    // local 模式无需登录；已登录则回来源页。
    const from = searchParams.get("from") || "/";
    if (!isBackendMode()) return <Navigate to="/" replace />;
    if (token) return <Navigate to={from} replace />;

    const completeAuthentication = (session: AuthSession, successMessage: string) => {
        setSession({ token: session.token, refreshToken: session.refreshToken, user: session.user });
        message.success(successMessage);
        navigate(from, { replace: true });
    };

    const openVerification = (email: string, token: string, countdown = 0, expiresIn = 600) => {
        setVerificationEmail(email.trim().toLowerCase());
        setChallengeToken(token);
        setVerificationCode("");
        setResendCountdown(Math.max(0, countdown));
        setVerificationExpiresIn(Math.max(60, expiresIn));
    };

    const handleSubmit = async (values: FormValues) => {
        if (mode === "register" && !platform.allowRegistration) {
            message.warning("平台暂未开放注册");
            setMode("login");
            return;
        }
        setSubmitting(true);
        try {
            if (mode === "login") {
                completeAuthentication(await login(values.email, values.password), "登录成功");
                return;
            }
            const result = await register(values.email, values.password, values.displayName);
            if ("verificationRequired" in result) {
                openVerification(result.email, result.challengeToken, result.resendAfterSeconds, result.expiresInSeconds);
                message.success("验证码已发送，请查收邮箱");
                return;
            }
            completeAuthentication(result, "注册成功");
        } catch (error) {
            const code = extractErrorCode(error);
            message.error(extractErrorMessage(error, mode === "login" ? "登录失败" : "注册失败"));
        } finally {
            setSubmitting(false);
        }
    };

    const handleVerifyEmail = async () => {
        if (verificationCode.length !== 6) {
            message.warning("请输入 6 位验证码");
            return;
        }
        setVerifying(true);
        try {
            completeAuthentication(await verifyEmail(verificationEmail, verificationCode, challengeToken), "邮箱验证成功，欢迎加入");
        } catch (error) {
            const code = extractErrorCode(error);
            if (code === "verification_expired" || code === "verification_attempts_exceeded") {
                setVerificationCode("");
                setResendCountdown(0);
            }
            message.error(extractErrorMessage(error, "邮箱验证失败"));
        } finally {
            setVerifying(false);
        }
    };

    const handleResend = async () => {
        if (resendCountdown > 0) return;
        setResending(true);
        try {
            const result = await resendVerification(verificationEmail, challengeToken);
            setResendCountdown(result.resendAfterSeconds ?? 60);
            message.success("新的验证码已发送");
        } catch (error) {
            if (extractErrorCode(error) === "verification_cooldown") setResendCountdown(60);
            message.error(extractErrorMessage(error, "重新发送失败"));
        } finally {
            setResending(false);
        }
    };

    return (
        <main className="flex min-h-dvh items-center justify-center overflow-y-auto bg-[#f3f3f1] px-3 py-3 text-stone-950 dark:bg-[#0b0b0a] dark:text-stone-100 sm:px-4 sm:py-4 md:px-6 md:py-6">
            {/* 响应式容器：移动端单列，md 起双列，2xl 起限宽防超宽屏拉伸 */}
            <div className="flex w-full max-w-sm flex-col overflow-hidden rounded-lg border border-stone-200 bg-white shadow-[0_24px_80px_rgba(28,25,23,0.09)] dark:border-stone-800 dark:bg-stone-950 dark:shadow-[0_24px_80px_rgba(0,0,0,0.35)] md:grid md:max-w-[820px] md:grid-cols-[minmax(0,1fr)_minmax(340px,400px)] lg:max-w-[960px] lg:grid-cols-[minmax(0,1.2fr)_minmax(360px,420px)] 2xl:max-w-[1100px] 2xl:grid-cols-[minmax(0,1.3fr)_440px]">
                {/* 左侧品牌区：移动端隐藏，md 起显示 */}
                <section className="relative hidden min-h-0 overflow-hidden bg-[#efefec] px-6 py-7 text-stone-950 transition-colors md:flex md:flex-col lg:px-9 lg:py-8 dark:bg-[#151513] dark:text-white">
                    <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(rgba(28,25,23,.14)_1px,transparent_1px)] [background-size:22px_22px] dark:bg-[radial-gradient(rgba(255,255,255,.13)_1px,transparent_1px)]" />
                    <div className="relative min-h-0">
                        <div className="flex items-center gap-2 text-sm font-semibold">
                            <span className="size-5 bg-amber-500" style={{ mask: `url(${platform.logoUrl}) center / contain no-repeat`, WebkitMask: `url(${platform.logoUrl}) center / contain no-repeat` }} />
                            {platform.siteName}
                        </div>
                        <div className="mt-7 max-w-md lg:mt-8">
                            <div className="mb-3 flex items-center gap-2 text-xs font-semibold text-amber-600 dark:text-amber-300">
                                <Sparkles className="size-3.5" />
                                CREATIVE OPERATING SYSTEM
                            </div>
                            <h1 className="text-2xl font-semibold leading-[1.2] tracking-normal lg:text-3xl xl:text-4xl">让每次灵感，都能成为下一次创作的起点。</h1>
                            <p className="mt-3 max-w-sm text-sm leading-6 text-stone-500 dark:text-white/55 lg:mt-4">在一个工作台里完成生成、编排、沉淀与复用，保留创作过程中的每个关键选择。</p>
                        </div>

                        <div className="mt-7 max-w-lg border-t border-stone-300 pt-4 dark:border-white/10 lg:mt-8 lg:pt-5">
                            <div className="grid grid-cols-3 gap-2 lg:gap-3">
                                {[
                                    { icon: ImagePlus, label: "生成", detail: "图片与视频" },
                                    { icon: Workflow, label: "编排", detail: "无限画布" },
                                    { icon: Check, label: "沉淀", detail: "资产与工作流" },
                                ].map(({ icon: Icon, label, detail }) => (
                                    <div key={label} className="min-w-0 border-l border-stone-300 pl-2 first:border-l-0 first:pl-0 dark:border-white/15 lg:pl-3">
                                        <Icon className="mb-2 size-4 text-amber-600 dark:text-amber-300" />
                                        <div className="text-xs font-medium lg:text-sm">{label}</div>
                                        <div className="mt-0.5 truncate text-[11px] text-stone-500 dark:text-white/40 lg:mt-1 lg:text-xs">{detail}</div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                </section>

                {/* 右侧表单区：flex 列自适应高度，移动端和桌面共用 */}
                <section className="relative flex flex-col px-5 py-6 transition-colors sm:px-8 sm:py-8 md:px-7 md:py-5 lg:px-8 lg:py-6">
                    <div className="flex items-center justify-between md:absolute md:right-6 md:top-5 md:z-10">
                        {/* 移动端显示 logo，md 起隐藏（左侧品牌区已有） */}
                        <div className="flex items-center gap-2 text-sm font-semibold md:hidden">
                            <img src={platform.logoUrl} width={24} height={24} alt="" className="size-6" />
                            {platform.siteName}
                        </div>
                        <AnimatedThemeToggler
                            theme={theme}
                            onThemeChange={setTheme}
                            className="inline-flex size-9 items-center justify-center rounded-md border border-stone-200 text-stone-500 transition hover:bg-stone-50 hover:text-stone-950 dark:border-stone-800 dark:text-stone-400 dark:hover:bg-stone-900 dark:hover:text-stone-100"
                            aria-label={theme === "dark" ? "切换到浅色主题" : "切换到深色主题"}
                        />
                    </div>

                    {/* 表单容器：flex-1 垂直居中，响应式 padding */}
                    <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-7 sm:py-8 md:py-3 md:pt-8 lg:py-4 lg:pt-8">
                        {verificationEmail ? (
                            <div>
                                <div className="mb-5">
                                    <div className="mb-4 grid size-11 place-items-center rounded-full border border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
                                        <MailCheck className="size-5" />
                                    </div>
                                    <div className="mb-2 text-[11px] font-semibold tracking-[0.12em] text-amber-600 dark:text-amber-400">EMAIL VERIFICATION</div>
                                    <h2 className="text-2xl font-semibold tracking-normal sm:text-3xl">验证你的邮箱</h2>
                                    <p className="mt-2 text-sm leading-6 text-stone-500 dark:text-stone-400">
                                        请输入发送至
                                        <span className="ml-1 break-all font-medium text-stone-800 dark:text-stone-200">{verificationEmail}</span>
                                        <span className="ml-1">的 6 位验证码。</span>
                                    </p>
                                </div>

                                <label htmlFor="email-verification-code" className="mb-2 block text-sm font-medium">
                                    邮箱验证码
                                </label>
                                <Input
                                    id="email-verification-code"
                                    value={verificationCode}
                                    onChange={(event) => setVerificationCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
                                    onPressEnter={() => void handleVerifyEmail()}
                                    inputMode="numeric"
                                    autoComplete="one-time-code"
                                    autoFocus
                                    maxLength={6}
                                    size="large"
                                    placeholder="000000"
                                    className="!h-12 !text-center !font-mono !text-xl !tracking-[0.45em]"
                                    prefix={<ShieldCheck className="size-4 text-stone-400" />}
                                />
                                <Button type="primary" block loading={verifying} disabled={verificationCode.length !== 6} className="mt-4 !h-11" icon={<ArrowRight className="size-4" />} iconPlacement="end" onClick={() => void handleVerifyEmail()}>
                                    完成验证并进入工作台
                                </Button>

                                <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-xs">
                                    <button
                                        type="button"
                                        disabled={resending || resendCountdown > 0}
                                        onClick={() => void handleResend()}
                                        className="inline-flex items-center gap-1.5 text-stone-500 transition hover:text-stone-950 disabled:cursor-not-allowed disabled:text-stone-300 dark:text-stone-400 dark:hover:text-white dark:disabled:text-stone-700"
                                    >
                                        <RefreshCw className={cn("size-3.5", resending && "animate-spin")} />
                                        {resendCountdown > 0 ? `${resendCountdown} 秒后可重新发送` : "重新发送验证码"}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setVerificationEmail("");
                                            setChallengeToken("");
                                            setVerificationCode("");
                                            setMode("login");
                                        }}
                                        className="inline-flex items-center gap-1 text-stone-400 transition hover:text-stone-950 dark:hover:text-white"
                                    >
                                        <ArrowLeft className="size-3.5" />
                                        返回登录
                                    </button>
                                </div>

                                <div className="mt-5 flex gap-2.5 border-t border-stone-200 pt-4 text-xs leading-5 text-stone-400 dark:border-stone-800 dark:text-stone-500">
                                    <ShieldCheck className="mt-0.5 size-3.5 shrink-0" />
                                    验证码 {Math.ceil(verificationExpiresIn / 60)} 分钟内有效。平台工作人员不会向你索要验证码，请勿转发给任何人。
                                </div>
                            </div>
                        ) : (
                            <>
                                <div className="mb-5">
                                    <div className="mb-2 text-[11px] font-semibold text-stone-400 dark:text-stone-500 md:mb-3 md:text-xs">ACCOUNT ACCESS</div>
                                    <h2 className="text-2xl font-semibold tracking-normal sm:text-3xl">{mode === "login" ? "欢迎回来" : "创建账号"}</h2>
                                    <p className="mt-1.5 text-sm leading-6 text-stone-500 dark:text-stone-400 md:mt-2">
                                        {mode === "login" ? "继续你的画布、任务与创作资产。" : platform.emailVerificationRequired ? "验证邮箱后保存并分享工作流。" : "保存并分享你的完整工作流。"}
                                    </p>
                                </div>

                                {/* 登录/注册切换 Tab */}
                                <div className={cn("mb-5 grid border-b border-stone-200 dark:border-stone-800", platform.allowRegistration ? "grid-cols-2" : "grid-cols-1")}>
                                    {(platform.allowRegistration ? (["login", "register"] as const) : (["login"] as const)).map((key) => (
                                        <button
                                            key={key}
                                            type="button"
                                            onClick={() => setMode(key)}
                                            className={cn(
                                                "relative h-10 text-sm font-medium transition after:absolute after:inset-x-0 after:-bottom-px after:h-0.5 md:h-11",
                                                mode === key ? "text-stone-950 after:bg-stone-950 dark:text-stone-100 dark:after:bg-stone-100" : "text-stone-400 after:bg-transparent hover:text-stone-700 dark:text-stone-500 dark:hover:text-stone-300",
                                            )}
                                        >
                                            {key === "login" ? "登录" : "注册"}
                                        </button>
                                    ))}
                                </div>

                                {/* 表单：响应式 size，移动端 middle，桌面 large */}
                                <Form layout="vertical" onFinish={handleSubmit} requiredMark={false} disabled={submitting} size="middle" className="[&_.ant-form-item]:mb-3.5">
                                    {mode === "register" ? (
                                        <div className="grid gap-x-3 md:grid-cols-2">
                                            <Form.Item name="displayName" label="昵称">
                                                <Input prefix={<UserRound className="size-4 text-stone-400" />} autoComplete="nickname" placeholder="显示名称" />
                                            </Form.Item>
                                            <Form.Item name="email" label="邮箱" rules={[{ required: true, type: "email", message: "请输入有效邮箱" }]}>
                                                <Input prefix={<Mail className="size-4 text-stone-400" />} autoComplete="email" placeholder="name@example.com" />
                                            </Form.Item>
                                        </div>
                                    ) : (
                                        <Form.Item name="email" label="邮箱" rules={[{ required: true, type: "email", message: "请输入有效邮箱" }]}>
                                            <Input prefix={<Mail className="size-4 text-stone-400" />} autoComplete="email" placeholder="name@example.com" />
                                        </Form.Item>
                                    )}
                                    <Form.Item
                                        name="password"
                                        label="密码"
                                        rules={
                                            mode === "register"
                                                ? [
                                                      { required: true, min: 8, max: 72, message: "密码长度需为 8-72 位" },
                                                      { pattern: /^(?=.*[A-Za-z])(?=.*\d).+$/, message: "密码需同时包含字母和数字" },
                                                  ]
                                                : [{ required: true, message: "请输入密码" }]
                                        }
                                    >
                                        <Input.Password prefix={<LockKeyhole className="size-4 text-stone-400" />} autoComplete={mode === "login" ? "current-password" : "new-password"} placeholder={mode === "login" ? "输入密码" : "8-72 位，含字母和数字"} />
                                    </Form.Item>
                                    <Button type="primary" htmlType="submit" block loading={submitting} className="mt-1 !h-10 md:!h-11" icon={<ArrowRight className="size-4" />} iconPlacement="end">
                                        {mode === "login" ? "进入工作台" : platform.emailVerificationRequired ? "创建账号并验证邮箱" : "创建账号"}
                                    </Button>
                                </Form>
                            </>
                        )}
                    </div>

                    {/* 底部 slogan：桌面端不再额外占高，移动端保留品牌收尾 */}
                    <div className="text-center text-xs text-stone-400 dark:text-stone-600 md:hidden">生成 · 编排 · 分享 · 复用</div>
                </section>
            </div>
        </main>
    );
}
