import { get } from "@/lib/api-client/request";
import { adaptDailyTakings } from "@/lib/adapters/takings.adapter";
import type { DailyTakings } from "@/lib/models/takings.model";

/**
 * The evening cash-up (37-09).
 *
 * Served by POS, not reporting. Till counts — `till_sessions.declared_closing_paisa`, the number a
 * human counted in the drawer — exist only in `pos_db` and never reach ClickHouse, so a
 * reporting-side implementation could show the takings and could NOT show whether the drawer
 * matched, which is the one question this screen exists to answer. Reading the system of record
 * also means the figures here are unaffected by DEFECT-37-03-B's corrupted fact timestamps.
 */
export const TakingsRepository = {
  async daily(date: string, branchId?: string): Promise<DailyTakings> {
    const params = new URLSearchParams();
    params.set("date", date);
    if (branchId) params.set("branchId", branchId);
    const raw = await get(`/api/v1/pos/takings/daily?${params.toString()}`);
    return adaptDailyTakings(raw);
  },
};
