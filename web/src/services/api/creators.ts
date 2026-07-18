import { httpClient } from "@/services/http-client";
import type { ContestEntry } from "@/services/api/contest";

export type CreatorProfile = {
    id: string;
    displayName: string;
    avatarUrl: string;
    followers: number;
    following: number;
    works: number;
    likes: number;
    followedByMe: boolean;
    mine: boolean;
    joinedAt: string;
};

export async function fetchCreator(id: string) {
    const { data } = await httpClient.get<{ creator: CreatorProfile; items: ContestEntry[] }>(`/creators/${encodeURIComponent(id)}`);
    return { creator: data.creator, items: data.items ?? [] };
}

export type CreatorFeedScope = "discover" | "following" | "favorites";

export async function fetchCreatorFeed(scope: CreatorFeedScope) {
    const { data } = await httpClient.get<{ items: ContestEntry[] }>("/creators/feed", { params: { scope, limit: 48 } });
    return data.items ?? [];
}

export async function followCreator(id: string, follow: boolean) {
    const path = `/creators/${encodeURIComponent(id)}/follow`;
    const { data } = follow
        ? await httpClient.post<{ following: boolean; followers: number }>(path)
        : await httpClient.delete<{ following: boolean; followers: number }>(path);
    return data;
}
