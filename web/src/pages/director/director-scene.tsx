import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

import type { DirectorLighting, DirectorShot } from "@/types/director";

export type DirectorSceneHandle = {
    capture: () => Promise<Blob>;
    resetCamera: () => void;
};

type DirectorSceneProps = {
    shot: DirectorShot;
    panoramaUrl?: string;
    onCameraChange: (angles: Pick<DirectorShot, "yaw" | "pitch">) => void;
};

type SceneRuntime = {
    renderer: THREE.WebGLRenderer;
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    controls: OrbitControls;
    target: THREE.Vector3;
    roll: number;
    lighting: {
        hemisphere: THREE.HemisphereLight;
        key: THREE.DirectionalLight;
        fill: THREE.PointLight;
        rim: THREE.SpotLight;
    };
};

const shotDistance: Record<DirectorShot["shotSize"], number> = {
    "extreme-wide": 10,
    wide: 7.6,
    full: 5.5,
    medium: 3.7,
    "close-up": 2.35,
    "extreme-close": 1.55,
};

const shotTargetHeight: Record<DirectorShot["shotSize"], number> = {
    "extreme-wide": 1.25,
    wide: 1.3,
    full: 1.35,
    medium: 1.55,
    "close-up": 1.82,
    "extreme-close": 1.94,
};

export const DirectorScene = forwardRef<DirectorSceneHandle, DirectorSceneProps>(function DirectorScene({ shot, panoramaUrl, onCameraChange }, ref) {
    const hostRef = useRef<HTMLDivElement>(null);
    const runtimeRef = useRef<SceneRuntime | null>(null);
    const textureRef = useRef<THREE.Texture | null>(null);
    const currentShotRef = useRef(shot);
    const cameraChangeRef = useRef(onCameraChange);

    currentShotRef.current = shot;
    cameraChangeRef.current = onCameraChange;

    useImperativeHandle(ref, () => ({
        capture: () => {
            const runtime = runtimeRef.current;
            if (!runtime) return Promise.reject(new Error("取景器尚未准备完成"));
            renderScene(runtime);
            return new Promise<Blob>((resolve, reject) => {
                runtime.renderer.domElement.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("无法生成镜头截图"))), "image/png", 0.96);
            });
        },
        resetCamera: () => {
            const runtime = runtimeRef.current;
            if (runtime) applyShotCamera(runtime, currentShotRef.current);
        },
    }));

    useEffect(() => {
        const host = hostRef.current;
        if (!host) return;

        const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, powerPreference: "high-performance" });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1.05;
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        renderer.domElement.setAttribute("aria-label", "导演台三维取景画面");
        renderer.domElement.dataset.testid = "director-canvas";
        host.appendChild(renderer.domElement);

        const scene = new THREE.Scene();
        scene.background = new THREE.Color("#101416");
        scene.fog = new THREE.Fog("#101416", 18, 48);

        const camera = new THREE.PerspectiveCamera(38, 16 / 9, 0.05, 160);
        const target = new THREE.Vector3(0, 1.55, 0);
        const controls = new OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true;
        controls.dampingFactor = 0.075;
        controls.enablePan = false;
        controls.minDistance = 1;
        controls.maxDistance = 55;
        controls.minPolarAngle = THREE.MathUtils.degToRad(35);
        controls.maxPolarAngle = THREE.MathUtils.degToRad(135);

        const hemisphere = new THREE.HemisphereLight("#e8f1ff", "#111012", 1.4);
        const key = new THREE.DirectionalLight("#fff4e8", 4.2);
        key.position.set(5, 7, 5);
        key.castShadow = true;
        key.shadow.mapSize.set(2048, 2048);
        key.shadow.camera.left = -8;
        key.shadow.camera.right = 8;
        key.shadow.camera.top = 8;
        key.shadow.camera.bottom = -8;
        const fill = new THREE.PointLight("#8ec5ff", 18, 18, 2);
        fill.position.set(-4, 3.5, 3);
        const rim = new THREE.SpotLight("#ffffff", 36, 22, Math.PI / 5, 0.55, 1.2);
        rim.position.set(1, 6, -5);
        rim.target.position.set(0, 1.4, 0);
        scene.add(hemisphere, key, fill, rim, rim.target);
        scene.add(createStudioSet());

        const runtime: SceneRuntime = { renderer, scene, camera, controls, target, roll: 0, lighting: { hemisphere, key, fill, rim } };
        runtimeRef.current = runtime;
        applyLighting(runtime, currentShotRef.current.lighting);
        applyShotCamera(runtime, currentShotRef.current);

        const handleControlEnd = () => {
            const position = camera.position.clone().sub(controls.target);
            const horizontal = Math.hypot(position.x, position.z);
            cameraChangeRef.current({
                yaw: normalizeDegrees(THREE.MathUtils.radToDeg(Math.atan2(position.x, position.z))),
                pitch: clamp(Math.round(THREE.MathUtils.radToDeg(Math.atan2(position.y, horizontal))), -45, 45),
            });
        };
        controls.addEventListener("end", handleControlEnd);

        const resize = () => {
            const width = Math.max(1, host.clientWidth);
            const height = Math.max(1, host.clientHeight);
            renderer.setSize(width, height, false);
            camera.aspect = width / height;
            camera.updateProjectionMatrix();
        };
        const observer = new ResizeObserver(resize);
        observer.observe(host);
        resize();

        let frame = 0;
        const animate = () => {
            frame = window.requestAnimationFrame(animate);
            controls.update();
            renderScene(runtime);
        };
        animate();

        return () => {
            window.cancelAnimationFrame(frame);
            observer.disconnect();
            controls.removeEventListener("end", handleControlEnd);
            controls.dispose();
            textureRef.current?.dispose();
            textureRef.current = null;
            scene.traverse((object) => {
                if (!(object instanceof THREE.Mesh)) return;
                object.geometry.dispose();
                const materials = Array.isArray(object.material) ? object.material : [object.material];
                materials.forEach((material) => material.dispose());
            });
            renderer.dispose();
            renderer.domElement.remove();
            runtimeRef.current = null;
        };
    }, []);

    useEffect(() => {
        const runtime = runtimeRef.current;
        if (runtime) applyShotCamera(runtime, shot);
    }, [shot]);

    useEffect(() => {
        const runtime = runtimeRef.current;
        if (runtime) applyLighting(runtime, shot.lighting);
    }, [shot.lighting]);

    useEffect(() => {
        const runtime = runtimeRef.current;
        if (!runtime) return;
        textureRef.current?.dispose();
        textureRef.current = null;
        runtime.scene.environment = null;
        runtime.scene.fog = new THREE.Fog("#101416", 18, 48);
        if (!panoramaUrl) {
            runtime.scene.background = new THREE.Color("#101416");
            return;
        }
        let cancelled = false;
        new THREE.TextureLoader().load(
            panoramaUrl,
            (texture) => {
                if (cancelled) return texture.dispose();
                texture.mapping = THREE.EquirectangularReflectionMapping;
                texture.colorSpace = THREE.SRGBColorSpace;
                textureRef.current = texture;
                runtime.scene.background = texture;
                runtime.scene.environment = texture;
                runtime.scene.fog = null;
            },
            undefined,
            () => {
                if (!cancelled) runtime.scene.background = new THREE.Color("#101416");
            },
        );
        return () => {
            cancelled = true;
        };
    }, [panoramaUrl]);

    return <div ref={hostRef} className="director-scene-host" />;
});

function applyShotCamera(runtime: SceneRuntime, shot: DirectorShot) {
    const targetY = shotTargetHeight[shot.shotSize];
    const baseDistance = shotDistance[shot.shotSize];
    const distance = baseDistance * (shot.focalLength / 35);
    const yaw = THREE.MathUtils.degToRad(shot.yaw);
    const pitch = THREE.MathUtils.degToRad(shot.pitch);
    const horizontal = distance * Math.cos(pitch);
    runtime.target.set(0, targetY, 0);
    runtime.controls.target.copy(runtime.target);
    runtime.camera.position.set(Math.sin(yaw) * horizontal, targetY + Math.sin(pitch) * distance, Math.cos(yaw) * horizontal);
    runtime.camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(24 / (2 * shot.focalLength)));
    runtime.camera.updateProjectionMatrix();
    runtime.roll = THREE.MathUtils.degToRad(shot.roll);
    runtime.controls.update();
    renderScene(runtime);
}

function renderScene(runtime: SceneRuntime) {
    runtime.camera.up.set(0, 1, 0);
    runtime.camera.lookAt(runtime.controls.target);
    runtime.camera.rotateZ(runtime.roll);
    runtime.renderer.render(runtime.scene, runtime.camera);
}

function applyLighting(runtime: SceneRuntime, preset: DirectorLighting) {
    const { hemisphere, key, fill, rim } = runtime.lighting;
    const presets: Record<DirectorLighting, { hemi: [string, string, number]; key: [string, number, [number, number, number]]; fill: [string, number, [number, number, number]]; rim: [string, number, [number, number, number]]; exposure: number }> = {
        softbox: { hemi: ["#e8f1ff", "#171314", 1.4], key: ["#fff4e8", 4.2, [5, 7, 5]], fill: ["#8ec5ff", 18, [-4, 3.5, 3]], rim: ["#ffffff", 36, [1, 6, -5]], exposure: 1.05 },
        daylight: { hemi: ["#dceeff", "#415038", 2.2], key: ["#fffbea", 5.8, [-5, 8, 4]], fill: ["#b7d8ff", 10, [4, 4, 2]], rim: ["#eaf6ff", 20, [2, 5, -5]], exposure: 1.1 },
        "golden-hour": { hemi: ["#ffd6a3", "#27354b", 1.25], key: ["#ff9d52", 6.8, [-6, 4, 5]], fill: ["#6fa8ff", 15, [5, 3, 1]], rim: ["#ffd3a1", 42, [2, 5, -5]], exposure: 1.08 },
        noir: { hemi: ["#cfd6df", "#030405", 0.28], key: ["#f7f7f4", 8.5, [-5, 5, 2]], fill: ["#5d6b7a", 2.5, [4, 2, 4]], rim: ["#ffffff", 62, [2, 6, -4]], exposure: 0.82 },
        neon: { hemi: ["#283547", "#120d18", 0.75], key: ["#ff2f93", 6.5, [5, 4, 3]], fill: ["#00d9ff", 34, [-4, 3, 3]], rim: ["#8a7dff", 48, [1, 5, -5]], exposure: 0.96 },
    };
    const value = presets[preset];
    hemisphere.color.set(value.hemi[0]);
    hemisphere.groundColor.set(value.hemi[1]);
    hemisphere.intensity = value.hemi[2];
    key.color.set(value.key[0]);
    key.intensity = value.key[1];
    key.position.set(...value.key[2]);
    fill.color.set(value.fill[0]);
    fill.intensity = value.fill[1];
    fill.position.set(...value.fill[2]);
    rim.color.set(value.rim[0]);
    rim.intensity = value.rim[1];
    rim.position.set(...value.rim[2]);
    runtime.renderer.toneMappingExposure = value.exposure;
}

function createStudioSet() {
    const set = new THREE.Group();
    const floorMaterial = new THREE.MeshStandardMaterial({ color: "#242a2b", roughness: 0.72, metalness: 0.05 });
    const floor = new THREE.Mesh(new THREE.CircleGeometry(18, 96), floorMaterial);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    set.add(floor);

    const wall = new THREE.Mesh(new THREE.CylinderGeometry(14, 14, 9, 80, 1, true), new THREE.MeshStandardMaterial({ color: "#171c1d", roughness: 0.86, side: THREE.BackSide }));
    wall.position.y = 4.5;
    wall.receiveShadow = true;
    set.add(wall);

    set.add(createActor());
    set.add(createChristmasTree());
    set.add(createGift(-1.55, 0.23, 0.72, "#b2232f", "#e9c56a"));
    set.add(createGift(-2.25, 0.17, 0.48, "#e7ddd0", "#aa2730"));
    set.add(createGift(2.2, 0.26, 0.68, "#234c45", "#d6af56"));

    const platform = new THREE.Mesh(new THREE.CylinderGeometry(1.45, 1.55, 0.12, 64), new THREE.MeshStandardMaterial({ color: "#111617", roughness: 0.45, metalness: 0.3 }));
    platform.position.y = 0.06;
    platform.receiveShadow = true;
    set.add(platform);

    const practicalMaterial = new THREE.MeshStandardMaterial({ color: "#c7923f", emissive: "#ffb24d", emissiveIntensity: 3.5 });
    for (const x of [-4.2, 4.2]) {
        const lamp = new THREE.Group();
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.035, 2.8, 12), new THREE.MeshStandardMaterial({ color: "#32383a", metalness: 0.7, roughness: 0.3 }));
        pole.position.y = 1.4;
        const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.09, 16, 16), practicalMaterial);
        bulb.position.y = 2.8;
        const light = new THREE.PointLight("#ffb65f", 12, 7, 2);
        light.position.y = 2.8;
        lamp.position.set(x, 0, -2.5);
        lamp.add(pole, bulb, light);
        set.add(lamp);
    }

    return set;
}

function createActor() {
    const actor = new THREE.Group();
    const coat = new THREE.MeshStandardMaterial({ color: "#a91f2b", roughness: 0.5 });
    const dark = new THREE.MeshStandardMaterial({ color: "#161a1d", roughness: 0.6 });
    const skin = new THREE.MeshStandardMaterial({ color: "#d4a17f", roughness: 0.72 });
    const fur = new THREE.MeshStandardMaterial({ color: "#f0e8da", roughness: 0.9 });

    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.42, 0.86, 8, 18), coat);
    torso.position.y = 1.35;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.31, 28, 22), skin);
    head.position.y = 2.18;
    const hat = new THREE.Mesh(new THREE.ConeGeometry(0.34, 0.72, 28), coat);
    hat.position.set(0.08, 2.69, 0);
    hat.rotation.z = -0.18;
    const hatTrim = new THREE.Mesh(new THREE.TorusGeometry(0.31, 0.07, 10, 28), fur);
    hatTrim.rotation.x = Math.PI / 2;
    hatTrim.position.y = 2.38;

    const leftArm = new THREE.Mesh(new THREE.CapsuleGeometry(0.13, 0.66, 6, 14), coat);
    leftArm.position.set(-0.52, 1.43, 0);
    leftArm.rotation.z = -0.22;
    const rightArm = leftArm.clone();
    rightArm.position.x = 0.52;
    rightArm.rotation.z = 0.22;
    const leftLeg = new THREE.Mesh(new THREE.CapsuleGeometry(0.15, 0.72, 6, 14), dark);
    leftLeg.position.set(-0.2, 0.47, 0);
    const rightLeg = leftLeg.clone();
    rightLeg.position.x = 0.2;

    actor.add(torso, head, hat, hatTrim, leftArm, rightArm, leftLeg, rightLeg);
    actor.traverse((object) => {
        if (object instanceof THREE.Mesh) {
            object.castShadow = true;
            object.receiveShadow = true;
        }
    });
    return actor;
}

function createChristmasTree() {
    const tree = new THREE.Group();
    tree.position.set(-3.1, 0, -2.2);
    const green = new THREE.MeshStandardMaterial({ color: "#285b46", roughness: 0.88 });
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.17, 0.75, 14), new THREE.MeshStandardMaterial({ color: "#4a3024", roughness: 0.9 }));
    trunk.position.y = 0.38;
    tree.add(trunk);
    [
        { y: 1.05, radius: 1.05, height: 1.8 },
        { y: 1.85, radius: 0.82, height: 1.55 },
        { y: 2.55, radius: 0.56, height: 1.25 },
    ].forEach((part) => {
        const cone = new THREE.Mesh(new THREE.ConeGeometry(part.radius, part.height, 32), green);
        cone.position.y = part.y;
        cone.castShadow = true;
        tree.add(cone);
    });
    const ornamentColors = ["#d23b3f", "#e4bd58", "#d9e8e5"];
    for (let index = 0; index < 18; index += 1) {
        const angle = index * 2.4;
        const y = 0.85 + (index % 6) * 0.38;
        const radius = Math.max(0.28, 0.95 - y * 0.22);
        const ornament = new THREE.Mesh(new THREE.SphereGeometry(0.055, 12, 12), new THREE.MeshStandardMaterial({ color: ornamentColors[index % ornamentColors.length], emissive: ornamentColors[index % ornamentColors.length], emissiveIntensity: 0.45 }));
        ornament.position.set(Math.sin(angle) * radius, y, Math.cos(angle) * radius);
        tree.add(ornament);
    }
    return tree;
}

function createGift(x: number, y: number, size: number, boxColor: string, ribbonColor: string) {
    const gift = new THREE.Group();
    gift.position.set(x, y, -0.6);
    const box = new THREE.Mesh(new THREE.BoxGeometry(size, size * 0.7, size), new THREE.MeshStandardMaterial({ color: boxColor, roughness: 0.64 }));
    const ribbonMaterial = new THREE.MeshStandardMaterial({ color: ribbonColor, roughness: 0.42, metalness: 0.12 });
    const vertical = new THREE.Mesh(new THREE.BoxGeometry(size * 0.16, size * 0.73, size * 1.02), ribbonMaterial);
    const horizontal = new THREE.Mesh(new THREE.BoxGeometry(size * 1.02, size * 0.73, size * 0.16), ribbonMaterial);
    gift.add(box, vertical, horizontal);
    gift.traverse((object) => {
        if (object instanceof THREE.Mesh) {
            object.castShadow = true;
            object.receiveShadow = true;
        }
    });
    return gift;
}

function normalizeDegrees(value: number) {
    const normalized = ((((Math.round(value) + 180) % 360) + 360) % 360) - 180;
    return normalized === -180 ? 180 : normalized;
}

function clamp(value: number, min: number, max: number) {
    return Math.min(max, Math.max(min, value));
}
