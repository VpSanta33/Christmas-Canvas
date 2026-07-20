import { nanoid } from "nanoid";
import { create } from "zustand";
import { persist, type PersistStorage, type StorageValue } from "zustand/middleware";

import { localForageStorage } from "@/lib/localforage-storage";
import { resolveImageUrl } from "@/services/image-storage";
import type { DirectorSceneSettings, DirectorShot } from "@/types/director";

type DirectorStore = DirectorSceneSettings & {
    hydrated: boolean;
    activeShotId: string;
    shots: DirectorShot[];
    updateScene: (patch: Partial<DirectorSceneSettings>) => void;
    addShot: () => string;
    duplicateShot: (id: string) => string | null;
    removeShot: (id: string) => void;
    moveShot: (id: string, direction: -1 | 1) => void;
    selectShot: (id: string) => void;
    updateShot: (id: string, patch: Partial<Omit<DirectorShot, "id" | "createdAt">>) => void;
};

const DIRECTOR_STORE_KEY = "christmas-canvas:director_store";

function createDefaultShot(index = 1): DirectorShot {
    const now = new Date().toISOString();
    return {
        id: nanoid(),
        title: `镜头 ${String(index).padStart(2, "0")}`,
        yaw: 22,
        pitch: 4,
        roll: 0,
        focalLength: 35,
        shotSize: "medium",
        composition: "thirds",
        lighting: "softbox",
        movement: "static",
        aspectRatio: "16:9",
        prompt: "",
        createdAt: now,
        updatedAt: now,
    };
}

const firstShot = createDefaultShot();

const directorStorage: PersistStorage<DirectorStore> = {
    getItem: async (name) => {
        const value = await localForageStorage.getItem(name);
        if (!value) return null;
        const parsed = JSON.parse(value) as StorageValue<DirectorStore>;
        const state = parsed.state;
        if (!state.shots?.length) {
            const shot = createDefaultShot();
            state.shots = [shot];
            state.activeShotId = shot.id;
        } else if (!state.shots.some((shot) => shot.id === state.activeShotId)) {
            state.activeShotId = state.shots[0].id;
        }
        if (state.panoramaStorageKey) state.panoramaUrl = await resolveImageUrl(state.panoramaStorageKey, state.panoramaUrl || "");
        state.shots = await Promise.all((state.shots || []).map(async (shot) => (shot.previewStorageKey ? { ...shot, previewUrl: await resolveImageUrl(shot.previewStorageKey, shot.previewUrl || "") } : shot)));
        return parsed;
    },
    setItem: (name, value) => localForageStorage.setItem(name, JSON.stringify(value)),
    removeItem: (name) => localForageStorage.removeItem(name),
};

export const useDirectorStore = create<DirectorStore>()(
    persist(
        (set, get) => ({
            hydrated: false,
            sceneTitle: "圣诞夜片场",
            sceneDescription: "温暖的圣诞客厅，窗外飘雪，壁炉、礼物和装饰树形成前中后景",
            subjectDescription: "穿红色冬季外套的主角，站在画面视觉中心",
            panoramaStorageKey: undefined,
            panoramaUrl: undefined,
            activeShotId: firstShot.id,
            shots: [firstShot],
            updateScene: (patch) => set(patch),
            addShot: () => {
                const source = get().shots.find((shot) => shot.id === get().activeShotId);
                const next = createDefaultShot(get().shots.length + 1);
                const shot = source ? { ...source, id: next.id, title: next.title, previewStorageKey: undefined, previewUrl: undefined, previewWidth: undefined, previewHeight: undefined, createdAt: next.createdAt, updatedAt: next.updatedAt } : next;
                set((state) => ({ shots: [...state.shots, shot], activeShotId: shot.id }));
                return shot.id;
            },
            duplicateShot: (id) => {
                const index = get().shots.findIndex((shot) => shot.id === id);
                if (index < 0) return null;
                const source = get().shots[index];
                const now = new Date().toISOString();
                const shot: DirectorShot = { ...source, id: nanoid(), title: `${source.title} 副本`, previewStorageKey: undefined, previewUrl: undefined, previewWidth: undefined, previewHeight: undefined, createdAt: now, updatedAt: now };
                set((state) => ({ shots: [...state.shots.slice(0, index + 1), shot, ...state.shots.slice(index + 1)], activeShotId: shot.id }));
                return shot.id;
            },
            removeShot: (id) => {
                const state = get();
                if (state.shots.length <= 1) return;
                const index = state.shots.findIndex((shot) => shot.id === id);
                const shots = state.shots.filter((shot) => shot.id !== id);
                const nextActiveId = state.activeShotId === id ? shots[Math.min(Math.max(index, 0), shots.length - 1)].id : state.activeShotId;
                set({ shots, activeShotId: nextActiveId });
            },
            moveShot: (id, direction) =>
                set((state) => {
                    const from = state.shots.findIndex((shot) => shot.id === id);
                    const to = from + direction;
                    if (from < 0 || to < 0 || to >= state.shots.length) return state;
                    const shots = [...state.shots];
                    [shots[from], shots[to]] = [shots[to], shots[from]];
                    return { shots };
                }),
            selectShot: (activeShotId) => set({ activeShotId }),
            updateShot: (id, patch) =>
                set((state) => ({
                    shots: state.shots.map((shot) => (shot.id === id ? { ...shot, ...patch, updatedAt: new Date().toISOString() } : shot)),
                })),
        }),
        {
            name: DIRECTOR_STORE_KEY,
            storage: directorStorage,
            partialize: (state) =>
                ({
                    sceneTitle: state.sceneTitle,
                    sceneDescription: state.sceneDescription,
                    subjectDescription: state.subjectDescription,
                    panoramaStorageKey: state.panoramaStorageKey,
                    panoramaUrl: state.panoramaUrl,
                    activeShotId: state.activeShotId,
                    shots: state.shots,
                }) as StorageValue<DirectorStore>["state"],
            onRehydrateStorage: () => () => useDirectorStore.setState({ hydrated: true }),
        },
    ),
);
