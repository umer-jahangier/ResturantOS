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
import { MoneyDisplay } from "@/components/ui/money-display";
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
        <label className="text-body">
          <span className="mb-1 block text-muted-foreground">Business date</span>
          <input
            type="date"
            value={shownDate}
            disabled={!shownDate}
            data-testid="takings-date"
            onChange={(e) => setDate(e.target.value)}
            className="rounded-md border bg-background px-2 py-1 disabled:opacity-50"
          />
        </label>
        {takings && (
          <p className="text-small text-muted-foreground">
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
        <h2 id="takings-summary-heading" className="text-small font-semibold text-muted-foreground">
          The day&apos;s money
        </h2>
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
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
          <FigureTile label="Comps" hint="Fully comped items." figure={takings.comps} />
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
          <h2 id="tender-heading" className="text-small font-semibold text-muted-foreground">
            How it came in
          </h2>
          <p className="text-label text-muted-foreground">
            Dated by when the money arrived, not by when its bill was finalised — so this is what
            the drawers and the card terminals took today, whether or not those orders are closed.
          </p>
          {/* This section's copy already promised the reader "what the drawers took today", and
              for tips it was not delivering: the server sent only what settled the bill, so a
              till's EXPECTED CASH — which counts a cash tip, because the guest put the note in
              the drawer — sat above a tender split that was short by exactly the day's cash tips,
              with the word "tip" nowhere on the page. The Tips column supplies the figure; this
              sentence supplies the rule for reading it, because a column that ADDS sitting beside
              a column that is a SUBSET is exactly the pair a tired reader gets backwards.

              A tip is deliberately absent from the tiles above. It is not gross, not net and not
              total billed — it never enters orders.total_paisa and finance books it as a liability
              owed to staff, not as revenue. It belongs here, where the question is what is in the
              drawer, and nowhere else on this screen. */}
          <p className="text-label text-muted-foreground" data-testid="tender-tip-note">
            A tip is money taken <strong>on top of</strong> the bill, so it is a separate column and
            is not inside Amount. It is not sales either — it is held for the staff, which is why no
            tile above includes it. A <strong>cash</strong> tip is in the drawer and is part of what
            a till is expected to hold; a card tip is not.
          </p>
        </div>
        <TenderSplit lines={takings.byTender} />
        <UnclosedTakingsNote unclosed={takings.unclosed} />
      </section>

      <section aria-labelledby="till-heading" className="space-y-3">
        <div>
          <h2 id="till-heading" className="text-small font-semibold text-muted-foreground">
            What each till counted
          </h2>
          <p className="text-label text-muted-foreground">
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
          <h2 id="residual-heading" className="text-small font-semibold text-muted-foreground">
            Also not known
          </h2>
          <ul className="space-y-1" data-testid="residual-unknowns">
            {takings.residualUnknowns.map((u) => (
              <li key={u.figure} className="text-small">
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
      data-unclosed-cash-tip-paisa={unclosed.cashTipPaisa}
      data-unclosed-total-paisa={unclosed.totalPaisa}
      data-unclosed-tip-paisa={unclosed.tipPaisa}
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
            <span data-testid="unclosed-cash-amount">
              <MoneyDisplay paisa={unclosed.cashPaisa} />
            </span>{" "}
            of today&apos;s cash is against{" "}
            {unclosed.orderCount === 1 ? "1 order" : `${unclosed.orderCount} orders`} that
            {unclosed.orderCount === 1 ? " is" : " are"} not closed yet
            {unclosed.totalPaisa !== unclosed.cashPaisa && (
              <>
                {" "}
                (
                <span data-testid="unclosed-total-amount">
                  <MoneyDisplay paisa={unclosed.totalPaisa} />
                </span>{" "}
                across all tenders)
              </>
            )}
            .
          </p>
          {/* "Expect the count to include it" is a promise about a drawer, and it was being made
              about the amounts only. A cash tip on one of these same open bills is in the drawer
              too, so the sentence was short by exactly that figure — and a counter acting on it
              would report the restaurant's own gratuity as an overage. Named separately rather
              than added into the amount above it, because the two answer different questions:
              one becomes a sale when the bill closes, the other never does. */}
          {unclosed.cashTipPaisa > 0 && (
            <p className="mt-1 font-medium">
              Plus{" "}
              <span data-testid="unclosed-cash-tip-amount">
                <MoneyDisplay paisa={unclosed.cashTipPaisa} />
              </span>{" "}
              of cash tips taken on those same bills. Also in the drawer, also to be counted — but
              never a sale, on any day: a tip is held for the staff.
            </p>
          )}
          <p className="mt-1 text-label">
            This money is part of the tender split above and is already in the drawer, so expect the
            count to include it. It is NOT in gross, net sales or total billed: a bill becomes a
            sale when it is closed, which may be tomorrow. Close those orders and the figures move —
            the cash does not get counted twice.
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
      className={cn("rounded-lg border p-3", emphasis && "border-primary/40 bg-primary/5")}
      data-testid={`figure-tile-${label.toLowerCase().replace(/\s+/g, "-")}`}
    >
      <p className="text-label uppercase tracking-wide text-muted-foreground">{label}</p>
      <div className="mt-1">
        {/* 38-08 task 3 — ONE money typeface. This screen rendered every amount in
            `font-mono`, alone in the product: UI-SPEC §3.11 reserves Geist Mono for IDENTIFIERS
            (an entry number, an account code, an order number) and makes every numeral tabular in
            `@layer base`, so money already aligns in the sans face and the mono was buying
            nothing but a second visual language for the same kind of value. An account code stays
            mono here and everywhere; the money does not. */}
        <FigureValue figure={figure} className={emphasis ? "text-h1 font-semibold" : "text-h2"} />
      </div>
      {/* The hint explains what a figure MEANS. When the figure is not known, the reason has
          already said everything there is to say, and a second sentence underneath it describing
          a number that is not there reads as though the number is there. */}
      {hint && figure.state === "KNOWN" && (
        <p className="mt-1 text-label text-muted-foreground">{hint}</p>
      )}
    </div>
  );
}
