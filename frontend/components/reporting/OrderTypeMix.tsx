"use client";

import { Meter } from "@/components/ui/meter";
import { formatNumber } from "@/lib/format/locale";
import { cn } from "@/lib/utils";

/**
 * Revenue split by order type — the `sales-by-order-type` report, drawn.
 *
 * <h3>Why this is meters and not a pie</h3>
 *
 * `ReportCatalog.java:130-142` returns one row per `order_type` with a count and a revenue, sorted
 * by revenue. The question an owner asks of it is *"how much of the night is delivery?"* — a
 * part-to-whole reading, on three or four categories, where the parts must be COMPARED to each
 * other and not merely seen. A pie makes that comparison an angle-estimation task and needs a
 * legend, which is a colour-matching task on top; ranked bars sharing one baseline make it a
 * length comparison, which is the one visual judgment people make accurately.
 *
 * <p>So this reuses `components/ui/meter.tsx` rather than drawing anything: the rows are already
 * ranked by the SQL, the shared primitive already renders `value / of` with the numerator and
 * denominator both spelled out, already routes money through `MoneyDisplay`, and already refuses
 * to draw a confident full bar when the denominator cannot divide. Hand-rolling an SVG here would
 * be a second, unpinned implementation of a bar with a denominator.
 *
 * <h3>The denominator is the period's own total, and it is honest</h3>
 *
 * `of` is the sum of `revenue_paisa` across the rows the report returned. The SQL has no `HAVING`
 * and no `LIMIT` below 10,000, so those rows ARE every order type that traded in the period —
 * the shares therefore sum to the whole and the whole is a real figure, not a target invented to
 * give the bar a scale. When the total is zero or unreadable the meters degrade to their stated
 * unknown state (D-38-16); they never render a share of nothing as `0%` or as a full bar.
 *
 * <h3>The order type is printed exactly as the wire spells it</h3>
 *
 * `DINE_IN` is rendered `DINE_IN`. Prettifying enum values is a rule that works until the day a
 * value arrives that it mangles, and it would put a different string in this panel from the one
 * in the grid two hundred pixels below it — leaving a reader to work out whether "Dine in" and
 * `DINE_IN` are the same row. The grid shows what the API said; so does this.
 */

export interface OrderTypeSlice {
  orderType: string;
  revenuePaisa: number | null;
  orderCount: number;
}

function readNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "bigint") return Number(value);
  return null;
}

/** Report rows → slices, or `null` when no row carried a usable order type. */
export function toOrderTypeSlices(
  rows: readonly Record<string, unknown>[],
): OrderTypeSlice[] | null {
  const slices: OrderTypeSlice[] = [];
  for (const row of rows) {
    const orderType = row.order_type;
    if (typeof orderType !== "string" || orderType === "") continue;
    slices.push({
      orderType,
      revenuePaisa: readNumber(row.revenue_paisa),
      orderCount: readNumber(row.order_count) ?? 0,
    });
  }
  return slices.length === 0 ? null : slices;
}

export function OrderTypeMix({
  slices,
  className,
}: {
  slices: readonly OrderTypeSlice[];
  className?: string;
}) {
  const totalPaisa = slices.reduce((sum, slice) => sum + (slice.revenuePaisa ?? 0), 0);
  const totalOrders = slices.reduce((sum, slice) => sum + slice.orderCount, 0);

  return (
    <div className={cn("space-y-(--space-md)", className)} data-testid="order-type-mix">
      <ul className="space-y-(--space-md)">
        {slices.map((slice) => (
          <li key={slice.orderType} className="space-y-1">
            {slice.revenuePaisa === null ? (
              <Meter
                label={slice.orderType}
                value={null}
                of={totalPaisa}
                format="money"
                unavailableReason="This order type reported no revenue figure"
              />
            ) : (
              <Meter
                label={slice.orderType}
                value={slice.revenuePaisa}
                of={totalPaisa}
                format="money"
                size="md"
              />
            )}
            <p className="text-label text-foreground-tertiary tabular-nums">
              {formatNumber(slice.orderCount)} order{slice.orderCount === 1 ? "" : "s"}
            </p>
          </li>
        ))}
      </ul>
      <p className="text-small text-foreground-tertiary tabular-nums">
        {formatNumber(slices.length)} order type{slices.length === 1 ? "" : "s"} ·{" "}
        {formatNumber(totalOrders)} order{totalOrders === 1 ? "" : "s"} in total
      </p>
    </div>
  );
}
