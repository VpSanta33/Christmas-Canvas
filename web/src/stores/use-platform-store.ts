import { create } from "zustand";

export type PublicPlatformSettings = {
    siteName: string;
    logoUrl: string;
    allowRegistration: boolean;
    registerGrantCredits: number;
    announcement: string;
    maintenanceEnabled: boolean;
    maintenanceNotice: string;
    emailVerificationRequired: boolean;
};

export const defaultPlatformSettings: PublicPlatformSettings = {
    siteName: "圣诞画布",
    logoUrl: "/logo.svg",
    allowRegistration: true,
    registerGrantCredits: 100,
    announcement: "",
    maintenanceEnabled: false,
    maintenanceNotice: "",
    emailVerificationRequired: false,
};

type PlatformState = {
    settings: PublicPlatformSettings;
    loaded: boolean;
    setSettings: (settings: PublicPlatformSettings) => void;
};

export const usePlatformStore = create<PlatformState>((set) => ({
    settings: defaultPlatformSettings,
    loaded: false,
    setSettings: (settings) => set({ settings, loaded: true }),
}));
