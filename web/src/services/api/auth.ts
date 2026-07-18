import { httpClient } from "@/services/http-client";
import type { AuthUser } from "@/stores/use-auth-store";

export type AuthSession = {
    token: string;
    refreshToken: string;
    user: AuthUser;
};

export type VerificationRequired = {
    verificationRequired: true;
    email: string;
    expiresInSeconds: number;
    resendAfterSeconds: number;
    challengeToken: string;
};

// 对应后端 internal/auth/handler.go 的 /auth/* 路由。
export async function login(email: string, password: string): Promise<AuthSession> {
    const { data } = await httpClient.post<AuthSession>("/auth/login", { email, password });
    return data;
}

export async function register(email: string, password: string, displayName?: string): Promise<AuthSession | VerificationRequired> {
    const { data } = await httpClient.post<AuthSession | VerificationRequired>("/auth/register", { email, password, displayName });
    return data;
}

export async function verifyEmail(email: string, code: string, challengeToken: string): Promise<AuthSession> {
    const { data } = await httpClient.post<AuthSession>("/auth/verify-email", { email, code, challengeToken });
    return data;
}

export async function resendVerification(email: string, challengeToken: string): Promise<{ ok: boolean; resendAfterSeconds?: number }> {
    const { data } = await httpClient.post<{ ok: boolean; resendAfterSeconds?: number }>("/auth/resend-verification", { email, challengeToken });
    return data;
}

export async function fetchMe(): Promise<AuthUser> {
    const { data } = await httpClient.get<{ user: AuthUser }>("/auth/me");
    return data.user;
}

export type UsageSummary = { used: number; limit: number; remaining: number };

export async function fetchUsage(): Promise<UsageSummary> {
    const { data } = await httpClient.get<UsageSummary>("/usage");
    return data;
}

export async function logout(): Promise<void> {
    await httpClient.post("/auth/logout", {});
}
