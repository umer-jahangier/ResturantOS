"use client";

import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { MoneyDisplay } from "@/components/ui/money-display";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type { RecipeCostPreview } from "@/lib/adapters/inventory.adapter";

/**
 * One entry of `RecipeCostPreview.lines`. No standalone adapter export exists for this shape
 * (`RecipeCostPreview` embeds it inline via `apiRecipeCostLineSchema`) — derived here rather than
 * duplicating the schema.
 */
export type RecipeCostLine = RecipeCostPreview["lines"][number];

interface RecipeCostPanelProps {
  preview: RecipeCostPreview | undefined;
  /** True while a recompute is in flight (`useRecipeCostPreview`'s `isFetching`). */
  isFetching: boolean;
  /** True only for the very first load (no `preview` has ever resolved yet). */
  isFirstLoad: boolean;
  menuItemName?: string;
  className?: string;
}

function formatFoodCostPct(pct: string | null | undefined): string | null {
  if (pct == null) return null;
  const n = Number(pct);
  if (Number.isNaN(n)) return null;
  return `${n.toFixed(1)}%`;
}

/**
 * Screen 3's sticky live plate-cost panel (INV-15). Presentational only — it fires no request of
 * its own; the page derives `preview`/`isFetching` from `useRecipeCostPreview` (already debounced
 * at 400ms, `placeholderData`-preserving) and passes them straight through. Every number rendered
 * here comes verbatim from the server payload — no cost arithmetic happens in this component; the
 * mini-bar's width in `RecipeCostLineShare` below is a display-only passthrough of the server's
 * own `sharePctOfBatch`.
 *
 * Loading semantics (UI-SPEC Screen 3's "Live" contract): on first load, render `Skeleton` blocks.
 * On a subsequent recompute (`isFetching` true with previous data present via `placeholderData`),
 * keep the previous values visible dimmed (`opacity-60`) with a "Recalculating…" caption — never a
 * blank panel and never a full-panel spinner.
 */
export function RecipeCostPanel({
  preview,
  isFetching,
  isFirstLoad,
  menuItemName,
  className,
}: RecipeCostPanelProps) {
  if (isFirstLoad || !preview) {
    return (
      <Card className={className}>
        <CardContent className="space-y-3 pt-4">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-8 w-40" />
          <Skeleton className="h-8 w-40" />
          <Skeleton className="h-4 w-24" />
        </CardContent>
      </Card>
    );
  }

  const foodCostText = formatFoodCostPct(preview.foodCostPct);

  return (
    <Card className={className}>
      <CardContent className={cn("space-y-4 pt-4", isFetching && "opacity-60")}>
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm text-muted-foreground">
            Plate cost{menuItemName ? ` · ${menuItemName}` : ""}
          </p>
          {isFetching && <p className="text-xs text-muted-foreground">Recalculating…</p>}
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-xs text-muted-foreground">Batch cost</p>
            <MoneyDisplay paisa={preview.batchCostPaisa} className="text-2xl text-primary" />
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Cost per portion</p>
            <MoneyDisplay paisa={preview.portionCostPaisa} className="text-2xl text-primary" />
          </div>
        </div>

        <div>
          <p className="text-xs text-muted-foreground">Food cost %</p>
          {foodCostText ? (
            <p className="text-sm text-foreground">{foodCostText}</p>
          ) : (
            <TooltipProvider delayDuration={300}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="cursor-help text-sm text-muted-foreground">—</span>
                </TooltipTrigger>
                <TooltipContent>No menu price to compare against</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
        </div>

        <p className="text-xs text-muted-foreground">
          Estimated from current ingredient cost — actual cost is set at depletion time.
        </p>

        {preview.excludedLineCount > 0 && (
          <p className="text-xs text-warning">
            {preview.excludedLineCount} line{preview.excludedLineCount === 1 ? "" : "s"} excluded
            from cost pending a fix.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

interface RecipeCostLineShareProps {
  line: RecipeCostLine;
  className?: string;
}

/**
 * Renders next to an ingredient line row: the whole-number share-of-batch-cost percentage plus a
 * mini horizontal bar (a div whose width is the share percentage) — or, when the server could not
 * price the line, the warning text in the warning token instead of a share.
 */
export function RecipeCostLineShare({ line, className }: RecipeCostLineShareProps) {
  if (line.warning) {
    return <p className={cn("text-xs text-warning", className)}>{line.warning}</p>;
  }

  const share = Math.round(line.sharePctOfBatch ?? 0);

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-muted">
        <div className="h-full bg-primary-solid" style={{ width: `${share}%` }} />
      </div>
      <span className="text-xs text-muted-foreground">{share}%</span>
    </div>
  );
}
