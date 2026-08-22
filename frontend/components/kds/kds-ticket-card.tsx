"use client";

import { AlertTriangle, Clock, Flame } from "lucide-react";

import { useKdsClock } from "@/lib/hooks/kds/use-kds-clock";
import {
  DEFAULT_ESCALATION_THRESHOLD_SECONDS,
  getAgingTreatment,
  type KdsAgingIcon,
} from "@/components/kds/kds-aging";
import { readElapsed } from "@/lib/format/elapsed";
import { T_BODY, T_H2, T_KDS, T_LABEL, T_SMALL } from "@/components/kds/kds-type";
import type { KdsTicket, KdsTicketItem } from "@/lib/models/kds.model";
import { cn } from "@/lib/utils";

interface KdsTicketCardProps {
  ticket: KdsTicket;
  /**
   * Items to render — defaults to `ticket.items`. Column fragments pass only that
   * column's items so a mixed-status order's fragment shows just the relevant subset
   * (KDS-04, item-centric board).
   */
  items?: KdsTicketItem[];
  /**
   * The 1–9/0 position number shown top-left. This is what makes number-key jump work
   * (UI-SPEC §7.2): a bump bar enumerates as a HID keyboard, so "press 3" only means
   * something if the third ticket says "3" on its face. Omitted past position 10.
   */
  positionNumber?: number;
  /**
   * The persistent focused-ticket concept, distinct from hover and from selection
   * (§7.2). One ticket on the board carries it at a time and it survives re-render,
   * because a bump bar has no pointer to hover with.
   */
  isFocused?: boolean;
  className?: string;
  /** Station `escalationThresholdSeconds` (KDS-05/D-13) — drives the ageing fraction. */
  escalationThresholdSeconds?: number;
}

const AGING_ICONS: Record<KdsAgingIcon, typeof Clock> = {
  clock: Clock,
  "alert-triangle": AlertTriangle,
  flame: Flame,
};

/** Human label for the order's service type. Neutral chip — type is not an alarm. */
function orderTypeLabel(orderType: string | null): string | null {
  switch (orderType) {
    case "DINE_IN":
      return "Dine-in";
    case "TAKEAWAY":
      return "Takeaway";
    case "PICKUP":
      return "Pickup";
    case "DELIVERY":
      return "Delivery";
    default:
      return null;
  }
}

/** Cancelled lines on the whole ticket — surfaced so the cook stops making them. */
function cancelledCount(ticket: KdsTicket): number {
  return ticket.items.filter((i) => i.status === "CANCELLED").length;
}

/**
 * The KDS ticket face (UI-SPEC §7.2), rebuilt against the phase-20 tokens.
 *
 * <h3>What changed and why it had to</h3>
 *
 * **The item list was one truncated line.** `formatItemNames` comma-joined every item into
 * a single `truncate`d 14px row: `2× Chicken Karahi, 1× Garlic Naan, 3× Raita…`. At the two
 * metres a wall-mounted board is actually read from, that is not a list — it is a grey
 * smear, and the third item is literally not on the screen. Now: **one item per line** at
 * `--text-kds` (22/28, weight 600, measured 16.09:1 on `--kds-card`), quantity in its own
 * fixed column so the eye scans counts vertically, **modifiers bold and inline beneath the
 * item they modify**, and notes in a visually distinct block. A modifier hidden inside a
 * notes field is how a nut allergy gets cooked; §7.2 forbids it and so does this component.
 *
 * **Sixteen hard-coded palette literals are gone.** `bg-gray-950`, `text-amber-300`,
 * `border-l-red-500` and friends are replaced by the `[data-surface="kds"]` tokens, so the
 * board is regenerable from `--brand-h` like everything else and its contrast is measured
 * by `design-tokens.test.ts` rather than hoped for.
 *
 * **Ageing is no longer colour.** See `kds-aging.ts` — three redundant channels plus a fill
 * change for late. This card renders all four.
 */
export function KdsTicketCard({
  ticket,
  items,
  positionNumber,
  isFocused,
  className,
  escalationThresholdSeconds,
}: KdsTicketCardProps) {
  const now = useKdsClock();
  const ageMs = now - ticket.receivedAt.getTime();
  /*
   * ONE reading, used for the face AND for what a screen reader hears, per `elapsed.ts`:
   * reading the text from one function and the threshold from another is how `Oldest 113h 52m`
   * ended up wrapped in an ACT NOW treatment.
   *
   * This also bounds the chip. The card's own `formatAge` ran `h:mm:ss` forever, so a ticket
   * left on the board over a close printed `113:52:07` at the two metres this face is read
   * from — noise, not a number. Past 24 h the chip now names the DAY the ticket was fired
   * (`7 Aug`), which is the only question worth answering about it, and the change of text
   * SHAPE is a colour-independent channel in its own right (D-38-13).
   */
  const elapsed = readElapsed(ticket.receivedAt, now);
  const displayItems = items ?? ticket.items;
  const aging = getAgingTreatment(
    ageMs,
    escalationThresholdSeconds ?? DEFAULT_ESCALATION_THRESHOLD_SECONDS,
    now,
  );
  const AgingIcon = AGING_ICONS[aging.icon];
  const typeLabel = orderTypeLabel(ticket.orderType);
  const cancelled = cancelledCount(ticket);
  const orderNotes = ticket.orderNotes?.trim();

  return (
    <div
      data-testid="kds-ticket-card"
      data-aging={aging.state}
      data-focused={isFocused ? "true" : undefined}
      style={{ borderLeftWidth: `${aging.borderWidthPx}px` }}
      className={cn(
        "flex flex-col rounded-lg border border-white/5",
        // CHANNEL 4 — late is a FILL change, not a hue change (§3.7). --kds-text on
        // --kds-late-fill measures 9.07:1, so the ticket stays AAA while it screams.
        aging.fillsCard ? "bg-kds-late-fill" : isFocused ? "bg-kds-card-focus" : "bg-kds-card",
        // The focused ticket carries a 2px --kds-text outline (§7.2). `outline` rather
        // than `ring` so it survives forced-colors mode on a kitchen terminal.
        isFocused && "outline-2 outline-kds-text outline-offset-[-2px]",
        aging.state === "fresh" && "border-l-kds-fresh",
        aging.state === "warn" && "border-l-kds-warn",
        aging.state === "late" && "border-l-kds-late",
        className,
      )}
    >
      {/* ── Header: position · order no · type/table · age ─────────────────────── */}
      <div className="flex items-start justify-between gap-2 px-3 pt-2.5 pb-2">
        <div className="flex min-w-0 items-center gap-2.5">
          {positionNumber !== undefined && (
            <span
              data-testid="kds-ticket-position"
              aria-label={`Ticket position ${positionNumber}`}
              className="flex size-8 shrink-0 items-center justify-center rounded-md bg-white/10 text-[28px] leading-none font-bold tabular-nums text-kds-text"
            >
              {positionNumber}
            </span>
          )}
          <span className={cn("truncate font-bold tracking-wide text-kds-text", T_H2)}>
            {ticket.orderNo ?? ticket.id.slice(0, 8)}
          </span>
        </div>

        {/* CHANNELS 2 + 3 — a distinct SHAPE and literal WORDS, never colour alone. */}
        <span
          data-testid="kds-ticket-age"
          data-aging-chip={aging.state}
          aria-label={aging.srLabel}
          className={cn(
            "inline-flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 font-bold tabular-nums",
            T_H2,
            "bg-black/25",
            aging.accentClass,
          )}
        >
          <AgingIcon
            className="size-5 shrink-0"
            aria-hidden="true"
            // Flame is FILLED — a solid mass reads differently from an outline even when
            // hue and luminance are both gone.
            fill={aging.state === "late" ? "currentColor" : "none"}
            strokeWidth={aging.state === "fresh" ? 2 : 2.5}
          />
          {elapsed.compact}
          {aging.chipSuffix && <span className="tracking-wider">{aging.chipSuffix}</span>}
        </span>
      </div>

      {/* ── Sub-header: service type · table · flags ───────────────────────────── */}
      <div
        className={cn(
          "flex flex-wrap items-center gap-x-2 gap-y-1 px-3 pb-2 text-kds-muted",
          T_SMALL,
        )}
      >
        {typeLabel && (
          <span
            data-testid="kds-ticket-order-type"
            className="rounded bg-white/10 px-1.5 py-0.5 font-semibold uppercase tracking-wide text-kds-text"
          >
            {typeLabel}
          </span>
        )}
        <span className="font-medium">
          {ticket.tableNumber ? `Table ${ticket.tableNumber}` : "No table"}
        </span>
        {ticket.priority && (
          <span
            className={cn(
              "rounded bg-kds-late px-1.5 py-0.5 font-bold uppercase tracking-wider text-black",
              T_LABEL,
            )}
          >
            PRIORITY
          </span>
        )}
        {cancelled > 0 && (
          <span
            data-testid="kds-ticket-cancelled-indicator"
            className="rounded bg-black/40 px-1.5 py-0.5 font-bold text-kds-late"
            title={`${cancelled} item(s) cancelled`}
          >
            ⊘ {cancelled} cancelled
          </span>
        )}
      </div>

      {/* ── The items. One per line. This is the part read at two metres. ──────── */}
      <ul className="flex flex-col gap-1.5 border-t border-white/10 px-3 py-2.5">
        {displayItems.map((item) => {
          const itemNotes = item.notes?.trim();
          return (
            <li key={item.id} data-testid={`kds-item-${item.id}`} className="flex gap-2.5">
              <span className={cn("shrink-0 font-semibold tabular-nums text-kds-muted", T_KDS)}>
                {item.qty}×
              </span>
              <div className="min-w-0 flex-1">
                <span className={cn("block font-semibold text-kds-text", T_KDS)}>{item.name}</span>
                {/* Modifiers are BOLD and INLINE beneath their own item — never merged
                    into a notes field, never attached to the wrong line (§7.2). */}
                {item.modifiers.length > 0 && (
                  <span
                    data-testid={`kds-item-modifiers-${item.id}`}
                    className={cn("block pl-3 font-bold text-kds-warn", T_BODY)}
                  >
                    {item.modifiers.join(", ")}
                  </span>
                )}
                {itemNotes && (
                  <span
                    data-testid={`kds-item-notes-${item.id}`}
                    className={cn(
                      "mt-0.5 block rounded border-l-2 border-kds-warn bg-black/30 px-2 py-1 font-medium text-kds-text",
                      T_BODY,
                    )}
                  >
                    ▸ {itemNotes}
                  </span>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      {/* ── Order-level notes block, visually distinct from every item line ────── */}
      {orderNotes && (
        <div
          data-testid="kds-ticket-notes"
          className={cn(
            "mx-3 mb-2.5 rounded border-l-4 border-kds-warn bg-black/30 px-2.5 py-1.5 font-semibold text-kds-text",
            T_BODY,
          )}
        >
          ▸ {orderNotes}
        </div>
      )}
    </div>
  );
}
