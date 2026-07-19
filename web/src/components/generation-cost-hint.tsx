import { Coins } from "lucide-react";

import { isBackendMode } from "@/constant/runtime-config";
import { estimatedGenerationCost } from "@/lib/generation-cost";
import { useAuthStore } from "@/stores/use-auth-store";
import { resolveModelChannel, type AiConfig } from "@/stores/use-config-store";

export function GenerationCostHint({ config, model, requests = 1 }: { config: AiConfig; model: string; requests?: number }) {
    const credits = useAuthStore((state) => state.user?.credits ?? 0);
    if (!isBackendMode() || !model || resolveModelChannel(config, model).source !== "platform") return null;
    const cost = estimatedGenerationCost(config, model, requests);
    const insufficient = cost > credits;

    return (
        <div className="mb-2 flex min-h-6 items-center justify-between gap-3 text-xs text-stone-500 dark:text-stone-400">
            <span className={`inline-flex items-center gap-1.5 ${insufficient ? "font-medium text-rose-600 dark:text-rose-300" : ""}`}>
                <Coins className="size-3.5" />
                {cost > 0 ? `预计 ${cost} 积分` : "本次免费"}
            </span>
            <span className="tabular-nums">余额 {credits}</span>
        </div>
    );
}
