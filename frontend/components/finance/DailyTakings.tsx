"use client";

import { useCallback, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { EmptyState } from "@/components/ui/empty-state";
import { QueryBoundary } from "@/components/ui/query-boundary";
import { FigureValue } from "@/components/finance/UnknownFigure";
import { TenderSplit } from "@/components/finance/TenderSplit";
import { TillVariancePanel } from "@/components/finance/TillVariancePanel";
import { useDailyTakings } from "@/lib/hooks/finance/use-daily-takings";
import { useUsers } from "@/lib/hooks/use-users";
import type { DailyTakings as DailyTakingsModel, MoneyFigure } from "@/lib/models/takings.model";
import { cn } from "@/lib/utils";

/**
 * The screen a restaurant owner opens first, every evening (D-37-02).
 *
 * <h3>No animated numbers here, deliberately</h3>
 *
 * The design system's `AnimatedNumber` rolls a figure up to its value. That is right for a
 * dashboard tile and wrong for this screen, because someone reads these numbers with a fistful of
 * cash in the other hand: an animated total DISPLAYS A SEQUENCE OF WRONG VALUES on its way to the
 * right one, and a manager who glances mid-roll counts against a number that was never true. Every
 * amount here appears at its final value on first paint. (Recorded here because 37-12's plan asked
 * for the decision either way, and 37-13's guide repeats it to the owner.)
 *
 * <h3>Nothing on this screen is computed from anything else on it</h3>
 *
 * Not net from gross, not the tender total, not an aggregate variance. The server states every
 * figure and this component renders them. A second implementation of an identity is a second thing
 * to drift, and the drift would be silent (T-32-12-E).
 */
export function DailyTakings() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const urlDate = searchParams.get("date");
  const [fallbackDate] = useState(() => new Date().toISOString().slice(0, 10));
  const date = urlDate ?? fallbackDate;

  const setDate = useCallback(
    (next: string) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set("date", next);
      router.replace(`${pathname}?${params.toString()}`);
    },
    [pathname, router, searchParams],
  );

  const query = useDailyTakings(date);

  // Decoration, and structurally unable to break the screen: it is NOT passed to the boundary, so
  // a 403 from `users.view` (which a manager cashing up may well get) leaves the takings intact and
  // the tills fall back to a short session id. Failing the cash-up because the roster was refused
  // would be the product refusing to show money over a cosmetic.
  const roster = useUsers({ size: 200 });
  const cashierNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const u of roster.data?.data ?? []) map.set(u.id, u.fullName ?? u.email);
    return map;
  }, [roster.data]);

  const takings = query.data;
  // "Nothing happened on this date" is a real answer and is NOT the same as "the request failed".
  // The QueryBoundary checks error first and only consults this once the query resolved cleanly.
  const isEmpty = !!takings && takings.orderCount === 0 && takings.tills.length === 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <label className="text-sm">
          <span className="mb-1 block text-muted-foreground">Business date</span>
          <input
            type="date"
            value={date}
            data-testid="takings-date"
            onChange={(e) => setDate(e.target.value)}
            className="rounded border bg-background px-2 py-1"
          />
        </label>
        {takings && (
          <p className="text-sm text-muted-foreground">
            {takings.orderCount} {takings.orderCount === 1 ? "order" : "orders"} closed on this
            trading day
          </p>
        )}
      </div>

      <QueryBoundary
        query={query}
        what="the day's takings"
        moduleLabel="Finance"
        isEmpty={isEmpty}
        empty={
          <EmptyState
            title="No trading recorded on this date"
            description="No order was closed and no till was opened. This is what the system holds — it is not a loading or permission problem."
          />
        }
      >
        {takings && <TakingsBody takings={takings} cashierNames={cashierNames} />}
      </QueryBoundary>
    </div>
  );
}

function TakingsBody({
  takings,
  cashierNames,
}: {
  takings: DailyTakingsModel;
  cashierNames: Map<string, string>;
}) {
  return (
    <div className="space-y-6">
      <section aria-labelledby="takings-summary-heading" className="space-y-3">
        <h2 id="takings-summary-heading" className="text-sm font-semibold text-muted-foreground">
          The day&apos;s money
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <FigureTile
            label="Gross sales"
            hint="Full menu price of everything sold, before any discount."
            figure={takings.gross}
          />
          <FigureTile
            label="Discounts"
            hint="Given away. Shown here rather than netted into a smaller sales figure."
            figure={takings.discounts}
          />
          <FigureTile
            label="Comps"
            hint="Fully comped items."
            figure={takings.comps}
          />
          <FigureTile label="Tax" figure={takings.tax} />
          <FigureTile label="Service charge" figure={takings.serviceCharge} />
          <FigureTile
            label="Net sales"
            hint="What the bills actually came to. Stated by the server, not worked out here."
            figure={takings.net}
            emphasis
          />
        </div>
      </section>

      <section aria-labelledby="tender-heading" className="space-y-3">
        <h2 id="tender-heading" className="text-sm font-semibold text-muted-foreground">
          How it came in
        </h2>
        <TenderSplit lines={takings.byTender} />
      </section>

      <section aria-labelledby="till-heading" className="space-y-3">
        <div>
          <h2 id="till-heading" className="text-sm font-semibold text-muted-foreground">
            What each till counted
          </h2>
          <p className="text-xs text-muted-foreground">
            Every till is listed on its own. Variances are never added together — two drawers out by
            opposite amounts is two problems, and one total of zero would hide both.
          </p>
        </div>
        <TillVariancePanel
          tills={takings.tills}
          cashierNames={cashierNames}
          dayCashVariance={takings.dayCashVariance}
        />
      </section>

      {takings.residualUnknowns.length > 0 && (
        <section aria-labelledby="residual-heading" className="space-y-2">
          <h2 id="residual-heading" className="text-sm font-semibold text-muted-foreground">
            Also not known
          </h2>
          <ul className="space-y-1" data-testid="residual-unknowns">
            {takings.residualUnknowns.map((u) => (
              <li key={u.figure} className="text-sm">
                <span className="font-medium">{u.figure}</span>
                <span className="text-muted-foreground"> — {u.reason}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function FigureTile({
  label,
  hint,
  figure,
  emphasis,
}: {
  label: string;
  hint?: string;
  figure: MoneyFigure;
  emphasis?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border p-3",
        emphasis && "border-primary/40 bg-primary/5",
      )}
      data-testid={`figure-tile-${label.toLowerCase().replace(/\s+/g, "-")}`}
    >
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <div className="mt-1">
        <FigureValue
          figure={figure}
          className={cn("font-mono", emphasis ? "text-2xl font-semibold" : "text-xl")}
        />
      </div>
      {/* The hint explains what a figure MEANS. When the figure is not known, the reason has
          already said everything there is to say, and a second sentence underneath it describing
          a number that is not there reads as though the number is there. */}
      {hint && figure.state === "KNOWN" && (
        <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
      )}
    </div>
  );
}
