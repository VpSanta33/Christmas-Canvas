import type { ReactNode } from "react";

import { AgentPanel } from "@/components/agent/agent-panel";
import { AppTopNav } from "@/components/layout/app-top-nav";
import { PlatformNotice } from "@/components/layout/platform-notice";
import { MediaUploadQueue } from "@/components/layout/media-upload-queue";

export default function UserLayout({ children }: { children: ReactNode }) {
    return (
        <div className="flex h-dvh overflow-hidden bg-background text-foreground">
            <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
                <AppTopNav />
                <PlatformNotice />
                <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
            </div>
            <AgentPanel />
            <MediaUploadQueue />
        </div>
    );
}
