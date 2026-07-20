import { Clapperboard, ImagePlus, Images, Layers3, ListTodo, Maximize2, Sparkles, UsersRound, Video } from "lucide-react";

export const navigationTools = [
    {
        slug: "canvas",
        label: "我的画布",
        icon: Maximize2,
    },
    {
        slug: "image",
        label: "生图工作台",
        icon: ImagePlus,
    },
    {
        slug: "video",
        label: "视频创作台",
        icon: Video,
    },
    {
        slug: "director",
        label: "导演台",
        icon: Clapperboard,
    },
    {
        slug: "creators",
        label: "创作者",
        icon: UsersRound,
    },
    {
        slug: "skills",
        label: "Skill 中心",
        icon: Sparkles,
    },
    {
        slug: "tasks",
        label: "任务中心",
        icon: ListTodo,
    },
    {
        slug: "workspace",
        label: "工作空间",
        icon: Layers3,
    },
    {
        slug: "assets",
        label: "我的资产",
        icon: Images,
    },
] as const;

export type NavigationToolSlug = (typeof navigationTools)[number]["slug"];
