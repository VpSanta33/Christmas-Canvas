export type DirectorShotSize = "extreme-wide" | "wide" | "full" | "medium" | "close-up" | "extreme-close";

export type DirectorComposition = "thirds" | "center" | "symmetry" | "golden" | "headroom";

export type DirectorLighting = "softbox" | "daylight" | "golden-hour" | "noir" | "neon";

export type DirectorMovement = "static" | "dolly-in" | "dolly-out" | "pan-left" | "pan-right" | "orbit" | "handheld";

export type DirectorAspectRatio = "16:9" | "9:16" | "1:1" | "4:3" | "2.39:1";

export type DirectorShot = {
    id: string;
    title: string;
    yaw: number;
    pitch: number;
    roll: number;
    focalLength: number;
    shotSize: DirectorShotSize;
    composition: DirectorComposition;
    lighting: DirectorLighting;
    movement: DirectorMovement;
    aspectRatio: DirectorAspectRatio;
    prompt: string;
    previewStorageKey?: string;
    previewUrl?: string;
    previewWidth?: number;
    previewHeight?: number;
    createdAt: string;
    updatedAt: string;
};

export type DirectorSceneSettings = {
    sceneTitle: string;
    sceneDescription: string;
    subjectDescription: string;
    panoramaStorageKey?: string;
    panoramaUrl?: string;
};
