"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { useCurrentUser } from "@/lib/hooks/auth/use-current-user";
import { useIngredients, usePostStockCount, useStockLevels } from "@/lib/hooks/inventory/use-inventory";
import { CatalogItemCombobox, type CatalogItemOption } from "@/components/shared/catalog-item-combobox";
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

interface CountLine {
  ingredientId: string;
  ingredientName: string;
  storageLocation: string | null;
  expectedQty: number;
  countedQty: string;
}

const UNGROUPED_LABEL = "Ungrouped";

/** A small threshold — any nonzero variance takes the warning wash; a typed-negative counted
 * value (impossible to submit — `StockCountDtos.CountLineRequest` is `@PositiveOrZero` — but
 * visible while the user is still typing) takes the destructive wash immediately. Same rule
 * StockTransferDialog.tsx's receive-adjust table uses, per UI-SPEC Screen 7's shared contract. */
function varianceRowClassName(variance: number, counted: number): string | undefined {
  if (counted < 0) return "bg-destructive/10";
  if (Math.abs(variance) > 0) return "bg-warning/10";
  return undefined;
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
          countedQty: "",
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
    .map((i) => ({ id: i.id, name: i.name, secondary: i.categoryName ?? undefined, sku: i.sku ?? undefined }));

  function addLine(option: CatalogItemOption) {
    setLines((prev) => [
      ...prev,
      {
        ingredientId: option.id,
        ingredientName: option.name,
        storageLocation: storageLocationById.get(option.id) ?? null,
        expectedQty: 0,
        countedQty: "",
      },
    ]);
  }

  function updateCounted(ingredientId: string, value: string) {
    setLines((prev) => prev.map((l) => (l.ingredientId === ingredientId ? { ...l, countedQty: value } : l)));
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
    const submittedLines = lines
      .filter((l) => l.countedQty.trim() !== "")
      .map((l) => ({ ingredientId: l.ingredientId, countedQty: l.countedQty.trim() }));
    if (submittedLines.length === 0) {
      toast.error("Enter at least one counted quantity before posting.");
      return;
    }
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
                      <th className="p-2 font-medium">Expected</th>
                      <th className="p-2 font-medium">Counted</th>
                      <th className="p-2 font-medium">Variance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {groupLines.map((line) => {
                      const counted = Number(line.countedQty) || 0;
                      const hasCounted = line.countedQty.trim() !== "";
                      const variance = hasCounted ? counted - line.expectedQty : 0;
                      return (
                        <tr
                          key={line.ingredientId}
                          className={cn(
                            "border-b last:border-b-0",
                            hasCounted && varianceRowClassName(variance, counted),
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
                          </td>
                        </tr>
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
