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
  /**
   * Omit `date` to ask for the trading day the restaurant is in RIGHT NOW.
   *
   * That day is `(now − 4h)`, not the calendar date, so between midnight and 04:00 UTC the two
   * differ — and a screen that defaulted to `new Date()` sent the person holding the drawer to a
   * blank page. The rule is the server's (`DailyTakingsService.currentBusinessDate`); asking for
   * "today" without naming it is what keeps a second copy of it from existing here.
   */
  async daily(date?: string | null, branchId?: string): Promise<DailyTakings> {
    const params = new URLSearchParams();
    if (date) params.set("date", date);
    if (branchId) params.set("branchId", branchId);
    const raw = await get(`/api/v1/pos/takings/daily?${params.toString()}`);
    return adaptDailyTakings(raw);
  },
};
