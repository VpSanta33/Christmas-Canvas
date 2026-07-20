import type { DirectorSceneSettings, DirectorShot } from "@/types/director";

export const shotSizeOptions = [
    { value: "extreme-wide", label: "大远景", prompt: "extreme wide establishing shot" },
    { value: "wide", label: "远景", prompt: "wide shot" },
    { value: "full", label: "全景", prompt: "full body shot" },
    { value: "medium", label: "中景", prompt: "medium shot" },
    { value: "close-up", label: "近景", prompt: "close-up shot" },
    { value: "extreme-close", label: "特写", prompt: "extreme close-up" },
] as const;

export const compositionOptions = [
    { value: "thirds", label: "三分法", prompt: "rule of thirds composition" },
    { value: "center", label: "居中", prompt: "centered composition" },
    { value: "symmetry", label: "对称", prompt: "symmetrical composition" },
    { value: "golden", label: "黄金分割", prompt: "golden ratio composition" },
    { value: "headroom", label: "人物安全框", prompt: "balanced headroom and cinematic safe framing" },
] as const;

export const lightingOptions = [
    { value: "softbox", label: "柔光棚", prompt: "soft studio key light, clean fill light, gentle rim light" },
    { value: "daylight", label: "自然日光", prompt: "natural daylight, neutral fill, realistic soft shadows" },
    { value: "golden-hour", label: "黄金时刻", prompt: "warm golden-hour key light, cool ambient fill, long soft shadows" },
    { value: "noir", label: "黑色电影", prompt: "high-contrast noir lighting, hard side key, deep sculpted shadows" },
    { value: "neon", label: "霓虹双色", prompt: "cyan and magenta neon cross-lighting, glossy cinematic highlights" },
] as const;

export const movementOptions = [
    { value: "static", label: "固定机位", prompt: "locked-off camera" },
    { value: "dolly-in", label: "缓慢推进", prompt: "slow dolly-in camera movement" },
    { value: "dolly-out", label: "缓慢拉远", prompt: "slow dolly-out camera movement" },
    { value: "pan-left", label: "向左摇镜", prompt: "smooth pan left" },
    { value: "pan-right", label: "向右摇镜", prompt: "smooth pan right" },
    { value: "orbit", label: "环绕运镜", prompt: "controlled orbit camera movement" },
    { value: "handheld", label: "手持跟随", prompt: "subtle handheld follow movement" },
] as const;

export const aspectRatioOptions = ["16:9", "9:16", "1:1", "4:3", "2.39:1"] as const;

export function buildDirectorPrompt(scene: DirectorSceneSettings, shot: DirectorShot) {
    const shotSize = shotSizeOptions.find((item) => item.value === shot.shotSize)?.prompt || "medium shot";
    const composition = compositionOptions.find((item) => item.value === shot.composition)?.prompt || "rule of thirds composition";
    const lighting = lightingOptions.find((item) => item.value === shot.lighting)?.prompt || "cinematic lighting";
    const movement = movementOptions.find((item) => item.value === shot.movement)?.prompt || "locked-off camera";
    const direction = cameraDirection(shot.yaw, shot.pitch);
    const roll = Math.abs(shot.roll) >= 1 ? `, ${Math.abs(shot.roll)} degree ${shot.roll > 0 ? "clockwise" : "counter-clockwise"} dutch angle` : "";
    const sceneText = scene.sceneDescription.trim() || "a cinematic production set";
    const subjectText = scene.subjectDescription.trim() || "the main subject";

    return [
        `Scene: ${sceneText}.`,
        `Subject: ${subjectText}.`,
        `Camera: ${shotSize}, ${shot.focalLength}mm lens, ${direction}${roll}, ${shot.aspectRatio} frame.`,
        `Composition: ${composition}.`,
        `Lighting: ${lighting}.`,
        `Movement: ${movement}.`,
        "Preserve character identity, spatial continuity, wardrobe, props and production design. Cinematic color science, physically plausible light, production-ready storyboard frame.",
    ].join("\n");
}

function cameraDirection(yaw: number, pitch: number) {
    const horizontal = Math.abs(yaw) < 12 ? "front view" : Math.abs(yaw) > 168 ? "rear view" : yaw > 0 ? `${Math.round(Math.abs(yaw))} degree right-side view` : `${Math.round(Math.abs(yaw))} degree left-side view`;
    const vertical = Math.abs(pitch) < 5 ? "eye-level camera" : pitch > 0 ? `${Math.round(Math.abs(pitch))} degree high-angle camera` : `${Math.round(Math.abs(pitch))} degree low-angle camera`;
    return `${horizontal}, ${vertical}`;
}
