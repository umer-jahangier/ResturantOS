"use client";

import { Fragment, useMemo, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle } from "lucide-react";

import { cn } from "@/lib/utils";
import { useCurrentUser } from "@/lib/hooks/auth/use-current-user";
import {
  useIngredients,
  usePostStockCount,
  useStockLevels,
} from "@/lib/hooks/inventory/use-inventory";
import {
  CatalogItemCombobox,
  type CatalogItemOption,
} from "@/components/shared/catalog-item-combobox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { FieldHelp } from "@/components/shared/field-help";

interface CountLine {
  ingredientId: string;
  ingredientName: string;
  storageLocation: string | null;
  expectedQty: number;
  /** The ingredient's effective variance cap (server-resolved up the category tree); null = uncapped. */
  varianceCapPct: number | null;
  countedQty: string;
  overrideReason: string;
}

const UNGROUPED_LABEL = "Ungrouped";

/** A small threshold — any nonzero variance takes the warning wash; a typed-negative counted
 * value (impossible to submit — `StockCountDtos.CountLineRequest` is `@PositiveOrZero` — but
 * visible while the user is still typing) takes the destructive wash immediately. Same rule
 * StockTransferDialog.tsx's receive-adjust table uses, per UI-SPEC Screen 7's shared contract. */
function varianceRowClassName(
  variance: number,
  counted: number,
  overCap: boolean,
): string | undefined {
  if (counted < 0) return "bg-destructive/10";
  // An over-cap variance is materially different from a routine one — it will be refused without a
  // reason — so it gets the destructive wash rather than the same amber every variance carries.
  if (overCap) return "bg-destructive/10";
  if (Math.abs(variance) > 0) return "bg-warning/10";
  return undefined;
}

/**
 * The line's variance as a percentage of expected, mirroring `StockCountService.variancePct`
 * exactly — including returning null at zero expected, where a percentage has no base. Any drift
 * between the two would show the user a warning the server disagrees with (or, worse, none where
 * the server refuses).
 */
function variancePct(variance: number, expected: number): number | null {
  if (expected === 0) return null;
  return (variance / Math.abs(expected)) * 100;
}

function isOverCap(pct: number | null, cap: number | null): boolean {
  return pct !== null && cap !== null && Math.abs(pct) > cap;
}

interface StockCountDialogProps {
  trigger?: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

/**
 * INV-15 (Screen 7 / INV-06): a count session grouped by storage location. Expected quantity is
 * dimmed informational text sourced straight from `useStockLevels` — the SAME branch-scoped read
 * model the stock page renders — never re-derived or re-fetched. `CatalogItemCombobox` lets a
 * manager add a line for an ingredient not already on the sheet (e.g. counting something found
 * that wasn't previously tracked at this branch); every other row is pre-populated.
 */
export function StockCountDialog({ trigger, open: openProp, onOpenChange }: StockCountDialogProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = openProp !== undefined;
  const open = isControlled ? openProp : internalOpen;

  const { branchId } = useCurrentUser();
  const { data: stockLevels } = useStockLevels();
  const { data: ingredients } = useIngredients();
  const postStockCount = usePostStockCount();

  const [lines, setLines] = useState<CountLine[]>([]);
  // Tracks the dialog's previous open state so the count sheet resets exactly on a
  // closed->open transition — an "adjust state while rendering" reset (React's recommended
  // alternative to `useEffect` + `setState`, which `react-hooks/set-state-in-effect` flags) since
  // this must fire for BOTH the controlled (parent flips `open`) and uncontrolled (trigger click)
  // paths, matching IngredientFormDialog's controlled/uncontrolled reset requirement exactly.
  const [lastOpen, setLastOpen] = useState(open);

  const storageLocationById = useMemo(() => {
    const map = new Map<string, string | null>();
    for (const i of ingredients ?? []) map.set(i.id, i.storageLocation ?? null);
    return map;
  }, [ingredients]);

  if (open !== lastOpen) {
    setLastOpen(open);
    if (open) {
      setLines(
        (stockLevels?.items ?? []).map((item) => ({
          ingredientId: item.ingredientId,
          ingredientName: item.ingredientName,
          storageLocation: storageLocationById.get(item.ingredientId) ?? null,
          expectedQty: Number(item.qtyOnHand),
          varianceCapPct: item.varianceCapPct == null ? null : Number(item.varianceCapPct),
          countedQty: "",
          overrideReason: "",
        })),
      );
    }
  }

  function handleOpenChange(next: boolean) {
    if (!isControlled) setInternalOpen(next);
    onOpenChange?.(next);
  }

  const addableOptions: CatalogItemOption[] = (ingredients ?? [])
    .filter((i) => !lines.some((l) => l.ingredientId === i.id))
    .map((i) => ({
      id: i.id,
      name: i.name,
      secondary: i.categoryName ?? undefined,
      sku: i.sku ?? undefined,
    }));

  function addLine(option: CatalogItemOption) {
    setLines((prev) => [
      ...prev,
      {
        ingredientId: option.id,
        ingredientName: option.name,
        storageLocation: storageLocationById.get(option.id) ?? null,
        expectedQty: 0,
        // Added ad hoc, so there is no stock row to read a cap from — and at zero expected there
        // is no percentage to cap anyway. Matches the server, which leaves such a line uncapped.
        varianceCapPct: null,
        countedQty: "",
        overrideReason: "",
      },
    ]);
  }

  function updateCounted(ingredientId: string, value: string) {
    setLines((prev) =>
      prev.map((l) => (l.ingredientId === ingredientId ? { ...l, countedQty: value } : l)),
    );
  }

  function updateOverrideReason(ingredientId: string, value: string) {
    setLines((prev) =>
      prev.map((l) => (l.ingredientId === ingredientId ? { ...l, overrideReason: value } : l)),
    );
  }

  const grouped = useMemo(() => {
    const groups = new Map<string, CountLine[]>();
    for (const line of lines) {
      const key = line.storageLocation ?? UNGROUPED_LABEL;
      const bucket = groups.get(key) ?? [];
      bucket.push(line);
      groups.set(key, bucket);
    }
    return Array.from(groups.entries());
  }, [lines]);

  const countedCount = lines.filter((l) => l.countedQty.trim() !== "").length;

  function onSubmit() {
    const counted = lines.filter((l) => l.countedQty.trim() !== "");
    if (counted.length === 0) {
      toast.error("Enter at least one counted quantity before posting.");
      return;
    }

    // Caught here so the user is pointed at the offending rows before a round trip. The server
    // enforces the same rule regardless — this is a courtesy, never the control itself.
    const missingReason = counted.filter((l) => {
      const variance = (Number(l.countedQty) || 0) - l.expectedQty;
      return (
        isOverCap(variancePct(variance, l.expectedQty), l.varianceCapPct) &&
        l.overrideReason.trim() === ""
      );
    });
    if (missingReason.length > 0) {
      toast.error(
        missingReason.length === 1
          ? `"${missingReason[0]!.ingredientName}" is over its variance cap — add a reason to post it.`
          : `${missingReason.length} items are over their variance cap — add a reason to each.`,
      );
      return;
    }

    const submittedLines = counted.map((l) => ({
      ingredientId: l.ingredientId,
      countedQty: l.countedQty.trim(),
      // Only sent for lines that actually breached; the server ignores it otherwise, so a stored
      // reason always means something.
      overrideReason: l.overrideReason.trim() || undefined,
    }));
    postStockCount.mutate(
      { branchId, lines: submittedLines },
      {
        onSuccess: () => {
          toast.success("Count posted");
          handleOpenChange(false);
        },
        onError: (error) => {
          toast.error(error.message || "Could not post the count. Please try again.");
        },
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      {trigger ? <DialogTrigger asChild>{trigger}</DialogTrigger> : null}
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Stock count</DialogTitle>
          <DialogDescription>
            {countedCount}/{lines.length} counted. Expected quantity is informational only.
          </DialogDescription>
        </DialogHeader>

        <div className="grid max-h-[60vh] gap-4 overflow-y-auto">
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <p className="mb-1 text-xs text-muted-foreground">Add an item not listed below</p>
              <CatalogItemCombobox
                options={addableOptions}
                value={null}
                onSelect={addLine}
                placeholder="Search ingredients…"
                emptyHeading="No ingredients match"
                emptyBody="Try a different search."
              />
            </div>
          </div>

          {grouped.map(([location, groupLines]) => (
            <div key={location} className="space-y-2">
              <h3 className="text-sm font-medium">{location}</h3>
              <div className="overflow-hidden rounded-md border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50">
                    <tr className="text-left text-muted-foreground">
                      <th className="p-2 font-medium">Ingredient</th>
                      <th className="p-2 font-medium">
                        <span className="inline-flex items-center gap-1.5">
                          Expected
                          <FieldHelp label="Expected">
                            What the system thinks is on the shelf, based on every delivery, sale
                            and transfer so far.
                          </FieldHelp>
                        </span>
                      </th>
                      <th className="p-2 font-medium">
                        <span className="inline-flex items-center gap-1.5">
                          Counted
                          <FieldHelp label="Counted">
                            What you actually found. Leave blank to skip an item — only lines you
                            fill in are posted.
                          </FieldHelp>
                        </span>
                      </th>
                      <th className="p-2 font-medium">
                        <span className="inline-flex items-center gap-1.5">
                          Variance
                          <FieldHelp label="Variance">
                            The gap between counted and expected. Posting writes this off, so a
                            large one needs a reason first.
                          </FieldHelp>
                        </span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {groupLines.map((line) => {
                      const counted = Number(line.countedQty) || 0;
                      const hasCounted = line.countedQty.trim() !== "";
                      const variance = hasCounted ? counted - line.expectedQty : 0;
                      const pct = hasCounted ? variancePct(variance, line.expectedQty) : null;
                      const overCap = isOverCap(pct, line.varianceCapPct);
                      return (
                        <Fragment key={line.ingredientId}>
                          <tr
                            className={cn(
                              "border-b last:border-b-0",
                              hasCounted && varianceRowClassName(variance, counted, overCap),
                              overCap && "border-b-0",
                            )}
                          >
                            <td className="p-2">{line.ingredientName}</td>
                            <td className="p-2 text-muted-foreground">{line.expectedQty}</td>
                            <td className="p-2">
                              <Input
                                inputMode="decimal"
                                aria-label={`Counted quantity for ${line.ingredientName}`}
                                value={line.countedQty}
                                onChange={(e) => updateCounted(line.ingredientId, e.target.value)}
                                className="h-8 w-24"
                              />
                            </td>
                            <td className="p-2 tabular-nums">
                              {hasCounted ? (variance > 0 ? `+${variance}` : variance) : "—"}
                              {pct !== null ? (
                                <span className="ml-1 text-xs text-muted-foreground">
                                  ({pct > 0 ? "+" : ""}
                                  {pct.toFixed(1)}%)
                                </span>
                              ) : null}
                            </td>
                          </tr>
                          {/* An over-cap line can still post — physical reality is physical reality
                              — but only deliberately and attributably. The reason is stored against
                              the line, so an auditor can later ask why a large write-off happened. */}
                          {overCap ? (
                            <tr className="border-b bg-destructive/10 last:border-b-0">
                              <td colSpan={4} className="px-2 pb-2">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="inline-flex items-center gap-1 text-xs text-destructive">
                                    <AlertTriangle className="size-3.5" aria-hidden="true" />
                                    Over the {line.varianceCapPct}% variance cap
                                  </span>
                                  <Input
                                    aria-label={`Reason for over-cap variance on ${line.ingredientName}`}
                                    placeholder="Reason required to post (e.g. spoilage written off)"
                                    value={line.overrideReason}
                                    onChange={(e) =>
                                      updateOverrideReason(line.ingredientId, e.target.value)
                                    }
                                    className="h-8 min-w-[16rem] flex-1"
                                  />
                                </div>
                              </td>
                            </tr>
                          ) : null}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" onClick={onSubmit} disabled={postStockCount.isPending}>
            {postStockCount.isPending ? "Posting…" : "Post count"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
