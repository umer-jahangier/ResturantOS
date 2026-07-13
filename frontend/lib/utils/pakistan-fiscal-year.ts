/** Pakistan FY (Jul–Jun): label = calendar year of the June end month. */
export function currentPakistanFiscalYear(date = new Date()): number {
  return date.getMonth() >= 6 ? date.getFullYear() + 1 : date.getFullYear();
}

export interface FiscalPeriodPreview {
  periodNo: number;
  fiscalYear: number;
  monthLabel: string;
  startDate: string;
  endDate: string;
}

/** Local mirror of OpenPeriodDatePicker's exact zero-padded ISO shape — kept
 * local to this lib file rather than importing from a component. */
function toIsoDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Computes the 12 monthly period date ranges (Jul of fiscalYear-1 through Jun
 * of fiscalYear) for ANY fiscal year, mirroring
 * AccountingPeriodServiceImpl.seedForTenant's exact backend formula:
 * month = ((6 + periodNo - 1) % 12) + 1; year = periodNo <= 6 ? startCalYear : fiscalYear.
 * No hardcoded year, no reference to `new Date()`/`currentPakistanFiscalYear()` —
 * fully caller-driven. Leap Februaries resolve correctly via `new Date(year, month, 0)`
 * day-0 rollback, with zero manual leap-year logic.
 */
export function getFiscalYearPeriods(fiscalYear: number): FiscalPeriodPreview[] {
  const startCalYear = fiscalYear - 1;
  const periods: FiscalPeriodPreview[] = [];
  for (let periodNo = 1; periodNo <= 12; periodNo += 1) {
    const month = ((6 + periodNo - 1) % 12) + 1;
    const year = periodNo <= 6 ? startCalYear : fiscalYear;
    const start = new Date(year, month - 1, 1);
    const lastDay = new Date(year, month, 0).getDate();
    const end = new Date(year, month - 1, lastDay);
    const monthLabel = start.toLocaleDateString(undefined, {
      month: "long",
      year: "numeric",
    });
    periods.push({
      periodNo,
      fiscalYear,
      monthLabel,
      startDate: toIsoDate(start),
      endDate: toIsoDate(end),
    });
  }
  return periods;
}
