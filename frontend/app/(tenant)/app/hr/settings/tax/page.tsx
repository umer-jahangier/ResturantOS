"use client";

import { useState } from "react";

import { HrErrorNotice } from "@/components/hr/hr-error-notice";
import { TaxConfigForm } from "@/components/hr/tax-config-form";
import { PermissionGuard } from "@/components/shared/permission-guard";
import { Select } from "@/components/ui/select";
import {
  useCurrentFiscalYear,
  useTaxConfig,
  useTaxConfigs,
} from "@/lib/hooks/hr/use-hr-config";

/**
 * Tax & EOBI configuration — the screen that unblocks payroll.
 *
 * <h2>Which year is open, and who decides</h2>
 *
 * The server does. `/api/v1/hr/config/tax/current` answers with the fiscal year today falls in,
 * computed by `FiscalYear.java`. A TypeScript copy of the "1 July starts a year named for the year
 * it ends in" rule would be a second implementation of a statutory convention, and when the two
 * drift the symptom is not a crash — it is this screen configuring FY2026 while payroll refuses
 * because FY2027 is missing, with both halves apparently working.
 *
 * <h2>Why an unconfigured year is not an error state here</h2>
 *
 * `GET /config/tax/{year}` answers `409 TAX_CONFIG_NOT_CONFIGURED` for a year with no row, which
 * arrives as a query error. On this screen that is the NORMAL first visit: nobody has entered this
 * year yet, and the correct response is a blank form with a sentence saying so — not a red banner
 * suggesting something broke. Any other failure still shows as a failure, because an accountant must
 * never be shown an empty tax table that is empty because the network dropped.
 */
export default function TaxSettingsPage() {
  const current = useCurrentFiscalYear();
  const years = useTaxConfigs();
  const [selectedYear, setSelectedYear] = useState<number | null>(null);

  const fiscalYear = selectedYear ?? current.data?.fiscalYear ?? null;
  const config = useTaxConfig(fiscalYear);

  const notConfigured = config.isError && config.error?.code === "TAX_CONFIG_NOT_CONFIGURED";
  const genuinelyFailed = config.isError && !notConfigured;

  const yearOptions = buildYearOptions(
    current.data?.fiscalYear,
    (years.data ?? []).map((y) => y.fiscalYear),
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold">Tax &amp; EOBI</h1>
          <p className="text-muted-foreground max-w-prose text-sm">
            The income-tax bands and EOBI rates payroll applies. Payroll refuses to run for a fiscal
            year that has none — it will not fall back to last year&apos;s rates, because a wrong
            payslip is worse than a refused run.
          </p>
        </div>
        <div className="w-48">
          <label className="text-muted-foreground mb-1 block text-xs" htmlFor="fiscal-year">
            Fiscal year
          </label>
          <Select
            id="fiscal-year"
            options={yearOptions}
            value={fiscalYear == null ? "" : String(fiscalYear)}
            onValueChange={(v) => setSelectedYear(Number(v))}
            isLoading={current.isPending}
            error={current.isError}
            onRetry={() => void current.refetch()}
          />
        </div>
      </div>

      {current.data && !current.data.configured && fiscalYear === current.data.fiscalYear ? (
        <div className="border-destructive/40 bg-destructive/5 rounded-lg border p-3 text-sm">
          <strong>Payroll cannot run yet.</strong> FY{current.data.fiscalYear} (
          {current.data.startsOn} to {current.data.endsOn}) has no tax table in force. Fill this in
          and tick “In force”.
        </div>
      ) : null}

      {genuinelyFailed ? (
        <HrErrorNotice
          what="this year's tax table"
          error={config.error}
          onRetry={() => void config.refetch()}
        />
      ) : config.isPending && fiscalYear != null && !notConfigured ? (
        <p className="text-muted-foreground text-sm">Loading…</p>
      ) : fiscalYear == null ? null : (
        <PermissionGuard
          require="hr.config.manage"
          fallback={
            <p className="text-muted-foreground text-sm">
              You can see this configuration but not change it. Editing the tax table is limited to
              the owner and tenant administrators.
            </p>
          }
        >
          <TaxConfigForm fiscalYear={fiscalYear} existing={notConfigured ? undefined : config.data} />
        </PermissionGuard>
      )}
    </div>
  );
}

/**
 * The current year, every year already configured, and the next one — so an accountant can enter
 * next year's table in June rather than discovering on 1 July that they cannot run payroll.
 */
function buildYearOptions(currentYear: number | undefined, configured: number[]) {
  const set = new Set<number>(configured);
  if (currentYear != null) {
    set.add(currentYear);
    set.add(currentYear + 1);
  }
  return [...set]
    .sort((a, b) => b - a)
    .map((y) => ({
      value: String(y),
      label: y === currentYear ? `FY${y} (current)` : `FY${y}`,
    }));
}
