import { httpClient } from "@/services/http-client";

// 对应后端 internal/credits/handler.go 的 /credits 与 /credits/ledger。

export type CreditLedgerItem = {
    delta: number;
    balanceAfter: number;
    reason: string;
    capability: string;
    model: string;
    note: string;
    createdAt: string;
};

// 查询当前用户积分余额。
export async function fetchCredits(): Promise<number> {
    const { data } = await httpClient.get<{ credits: number }>("/credits");
    return data.credits;
}

// 查询当前用户积分流水（消费/赠送/充值记录）。
export async function fetchCreditLedger(limit = 50): Promise<CreditLedgerItem[]> {
    const { data } = await httpClient.get<{ items: CreditLedgerItem[] }>("/credits/ledger", {
        params: { limit },
    });
    return data.items ?? [];
}
