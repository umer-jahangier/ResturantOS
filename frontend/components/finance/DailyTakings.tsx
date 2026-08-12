"use client";

import { useCallback, useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { EmptyState } from "@/components/ui/empty-state";
import { QueryBoundary } from "@/components/ui/query-boundary";
import { FigureValue } from "@/components/finance/UnknownFigure";
import { TenderSplit } from "@/components/finance/TenderSplit";
import { TillVariancePanel } from "@/components/finance/TillVariancePanel";
import { useDailyTakings } from "@/lib/hooks/finance/use-daily-takings";
import { useUsers } from "@/lib/hooks/use-users";
import { formatPaisa } from "@/lib/adapters/shared";
import type {
  DailyTakings as DailyTakingsModel,
  MoneyFigure,
  UnclosedTakings,
} from "@/lib/models/takings.model";
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

  // No client-side "today". The trading day is (now − 4h), so between midnight and 04:00 UTC the
  // calendar date names a day the restaurant has not started — and this screen opened on a blank
  // page while the drawer was full. With no `?date=` the server is asked for the day it is
  // currently in, and the input below is seeded from the `businessDate` it answers with, so the
  // rule exists in exactly one place (DailyTakingsService.currentBusinessDate).
  const urlDate = searchParams.get("date");

  const setDate = useCallback(
    (next: string) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set("date", next);
      router.replace(`${pathname}?${params.toString()}`);
    },
    [pathname, router, searchParams],
  );

  const query = useDailyTakings(urlDate);

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
  // The date the screen is ACTUALLY showing, which is a server fact whenever the URL does not
  // pin one. Empty until the first response lands; the input is disabled for that moment rather
  // than pre-filled with a guess that could then jump.
  const shownDate = urlDate ?? takings?.businessDate ?? "";

  // "Nothing happened on this date" is a real answer and is NOT the same as "the request failed".
  // The QueryBoundary checks error first and only consults this once the query resolved cleanly.
  //
  // MONEY TAKEN COUNTS AS TRADING. Leaving `byTender` out of this test is how the S0-02 defect
  // survived the query fix in rehearsal: with the cash restored to the tender split, a day whose
  // orders were all still open STILL rendered "No trading recorded on this date" — an empty state
  // sitting on top of a screen that had the figures in hand.
  const isEmpty =
    !!takings &&
    takings.orderCount === 0 &&
    takings.tills.length === 0 &&
    takings.byTender.length === 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <label className="text-sm">
          <span className="mb-1 block text-muted-foreground">Business date</span>
          <input
            type="date"
            value={shownDate}
            disabled={!shownDate}
            data-testid="takings-date"
            onChange={(e) => setDate(e.target.value)}
            className="rounded border bg-background px-2 py-1 disabled:opacity-50"
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
            description="No order was closed, no payment was taken and no till was opened. This is what the system holds — it is not a loading or permission problem."
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
          <FigureTile
            label="Net sales"
            hint="Gross sales less discounts. Tax and service charge are NOT in this figure — this is the revenue line."
            figure={takings.net}
          />
          <FigureTile
            label="Tax"
            hint="Charged on top of net sales and owed onward to the tax authority. Not revenue, and not inside net sales."
            figure={takings.tax}
          />
          <FigureTile
            label="Service charge"
            hint="Added to the bill on top of net sales. Shown on its own, not folded into it."
            figure={takings.serviceCharge}
          />
          <FigureTile
            label="Total billed"
            hint="What the bills actually came to: net sales plus tax plus service charge. This is the figure the tender split below reconciles against."
            figure={takings.totalBilled}
            emphasis
          />
        </div>
        {/* The identity is printed rather than left to be worked out. Before F5 this screen had one
            tile carrying the bill total under the word "net", so NET SALES read Rs 45,966.40 above
            a GROSS SALES of Rs 43,350.00 and an accountant reading it over-stated revenue by the
            whole output-tax line. Saying how the six tiles relate is what stops that reading from
            being available at all. It is a SENTENCE, not a computation — no number in it is
            derived on this page. */}
        <p className="text-label text-muted-foreground" data-testid="takings-identity">
          Gross sales − discounts = net sales. Net sales + tax + service charge = total billed.
        </p>
      </section>

      <section aria-labelledby="tender-heading" className="space-y-3">
        <div>
          <h2 id="tender-heading" className="text-sm font-semibold text-muted-foreground">
            How it came in
          </h2>
          <p className="text-label text-muted-foreground">
            Dated by when the money arrived, not by when its bill was finalised — so this is what
            the drawers and the card terminals took today, whether or not those orders are closed.
          </p>
        </div>
        <TenderSplit lines={takings.byTender} />
        <UnclosedTakingsNote unclosed={takings.unclosed} />
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

/**
 * How much of today's money is sitting against orders nobody has closed yet (S0-02).
 *
 * <h3>Why it is stated even when it is zero</h3>
 *
 * Silence is the failure this replaces. The old screen was silent about unclosed takings because
 * it did not know about them at all, and a manager counting a drawer that held Rs 77.00 more than
 * the screen admitted had nothing to read. So the panel is always present: "all of today's money
 * is on closed bills" is itself the answer somebody needs before they accept a variance as real.
 * A figure that appears only when it is inconvenient teaches people not to look for it.
 *
 * The amount is NOT added to anything. It is a part of the tender split already shown above, which
 * is why it is phrased as "of the money above" and never as its own total.
 */
function UnclosedTakingsNote({ unclosed }: { unclosed: UnclosedTakings }) {
  const has = unclosed.totalPaisa > 0;
  return (
    <div
      data-testid="unclosed-tender-panel"
      data-unclosed-cash-paisa={unclosed.cashPaisa}
      data-unclosed-total-paisa={unclosed.totalPaisa}
      data-unclosed-order-count={unclosed.orderCount}
      // The caution surface is the design system's `warning` token, not a raw amber ramp: the
      // token already carries its own light/dark values, so this reads correctly in both without
      // a `dark:` pair per property. Foreground stays `text-foreground` — measured in 38-01,
      // `text-warning-foreground` on a `bg-warning/10` surface does not hold contrast.
      className={cn(
        "rounded-lg border p-3 text-small",
        has ? "border-warning/40 bg-warning/10 text-foreground" : "text-muted-foreground",
      )}
    >
      {has ? (
        <>
          <p className="font-medium">
            <span className="font-mono tabular-nums" data-testid="unclosed-cash-amount">
              {formatPaisa(unclosed.cashPaisa)}
            </span>{" "}
            of today&apos;s cash is against{" "}
            {unclosed.orderCount === 1 ? "1 order" : `${unclosed.orderCount} orders`} that
            {unclosed.orderCount === 1 ? " is" : " are"} not closed yet
            {unclosed.totalPaisa !== unclosed.cashPaisa && (
              <>
                {" "}
                (
                <span className="font-mono tabular-nums" data-testid="unclosed-total-amount">
                  {formatPaisa(unclosed.totalPaisa)}
                </span>{" "}
                across all tenders)
              </>
            )}
            .
          </p>
          <p className="mt-1 text-label">
            This money is part of the tender split above and is already in the drawer, so expect
            the count to include it. It is NOT in gross, net sales or total billed: a bill becomes
            a sale when it is closed, which may be tomorrow. Close those orders and the figures
            move — the cash does not get counted twice.
          </p>
        </>
      ) : (
        <p data-testid="unclosed-none">
          Every payment taken today is against an order that has been closed. Nothing is being held
          against an open bill.
        </p>
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
