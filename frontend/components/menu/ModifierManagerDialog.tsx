"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Pencil, Plus, Trash2, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/ui/status-badge";
import { MoneyDisplay } from "@/components/ui/money-display";
import { QueryErrorNotice } from "@/components/ui/query-boundary";
import {
  useCreateModifierGroup,
  useCreateModifierOption,
  useDeleteModifierGroup,
  useDeleteModifierOption,
  useModifierGroupsAdmin,
  useUpdateModifierGroup,
} from "@/lib/hooks/pos/use-modifiers";
import { modifierGroupRule, type ModifierGroup } from "@/lib/models/modifier.model";
import type { MenuItem } from "@/lib/models/pos.model";
import { cn } from "@/lib/utils";

interface ModifierManagerDialogProps {
  item: MenuItem | null;
  onOpenChange: (open: boolean) => void;
}

/** Rs typed by a human → BIGINT paisa. Rejects anything that is not money. */
function parseRupees(text: string): { paisa: number } | { error: string } {
  const trimmed = text.trim();
  if (trimmed === "" || trimmed === "-") return { error: "Enter an amount, or 0 for free." };
  if (!/^-?\d+(\.\d{1,2})?$/.test(trimmed)) {
    return {
      error: "Use rupees and up to two decimals, like 150 or 150.50. No currency symbol.",
    };
  }
  // Parsed as two integer halves rather than `Number(x) * 100`: 150.7 * 100 is 15070.000000000002
  // in binary floating point, and money in this product is BIGINT paisa with no float on its path.
  const negative = trimmed.startsWith("-");
  const [whole, frac = ""] = trimmed.replace("-", "").split(".");
  const paisa = Number(whole) * 100 + Number(frac.padEnd(2, "0"));
  if (!Number.isSafeInteger(paisa)) return { error: "That amount is too large." };
  return { paisa: negative ? -paisa : paisa };
}

/**
 * Manage a dish's modifier groups and their priced options (S6).
 *
 * <p>This is the half of modifiers that never existed: `Modifier.java` and `ModifierGroup.java`
 * had been JPA entities since V1 with no repository, no service, no route and no screen. An owner
 * could not create a "Spice level" group, and a cashier therefore could not ring one.
 *
 * <p>Every refusal the server can give — a duplicate name, a minimum bigger than the group,
 * removing the last option a forced group depends on — is surfaced against the control that caused
 * it rather than as a toast that disappears, because each of them names a decision the manager has
 * to change before the dish is sellable.
 */
export function ModifierManagerDialog({ item, onOpenChange }: ModifierManagerDialogProps) {
  const groupsQuery = useModifierGroupsAdmin(item?.id ?? null);
  const createGroup = useCreateModifierGroup();
  const deleteGroup = useDeleteModifierGroup();
  const updateGroup = useUpdateModifierGroup();

  const [showNewGroup, setShowNewGroup] = useState(false);
  const [groupName, setGroupName] = useState("");
  const [groupRequired, setGroupRequired] = useState(false);
  const [groupMin, setGroupMin] = useState("0");
  const [groupMax, setGroupMax] = useState("1");
  const [groupError, setGroupError] = useState<string | null>(null);

  const groups = groupsQuery.data;

  function resetGroupForm() {
    setShowNewGroup(false);
    setGroupName("");
    setGroupRequired(false);
    setGroupMin("0");
    setGroupMax("1");
    setGroupError(null);
  }

  function submitGroup() {
    if (!item) return;
    const name = groupName.trim();
    const min = Number(groupMin);
    const max = Number(groupMax);
    if (name === "") {
      setGroupError("Name this group — a cashier reads it above the buttons, like “Spice level”.");
      return;
    }
    if (!Number.isInteger(min) || min < 0 || !Number.isInteger(max) || max < 1) {
      setGroupError("Minimum must be 0 or more and maximum at least 1.");
      return;
    }
    if (min > max) {
      setGroupError(`Minimum (${min}) cannot be more than maximum (${max}).`);
      return;
    }
    if (groupRequired && min < 1) {
      setGroupError("A required group must ask for at least one option. Set the minimum to 1.");
      return;
    }
    if (!groupRequired && min > 0) {
      setGroupError(
        `A minimum of ${min} makes this group required. Tick “Required”, or set the minimum to 0.`,
      );
      return;
    }
    setGroupError(null);
    createGroup.mutate(
      {
        menuItemId: item.id,
        input: { name, required: groupRequired, minSelect: min, maxSelect: max },
      },
      {
        onSuccess: () => {
          toast.success(`Added “${name}” to ${item.name}`);
          resetGroupForm();
        },
        onError: (error) => setGroupError(error.message || "Could not add the group."),
      },
    );
  }

  return (
    <Dialog
      open={item !== null}
      onOpenChange={(next) => {
        if (!next) {
          resetGroupForm();
          onOpenChange(false);
        }
      }}
    >
      <DialogContent className="max-w-2xl" data-testid="modifier-manager">
        <DialogHeader>
          <DialogTitle>Options for {item?.name}</DialogTitle>
          <DialogDescription>
            Groups of choices a cashier is offered when this dish is tapped — “Spice level”,
            “Extras”. A required group must be answered before the line can be added.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[60vh] space-y-4 overflow-y-auto pr-1">
          {groupsQuery.isError ? (
            <QueryErrorNotice
              what="this dish's option groups"
              moduleLabel="Menu"
              error={groupsQuery.error}
              isRetrying={groupsQuery.isFetching}
              onRetry={() => void groupsQuery.refetch()}
            />
          ) : groupsQuery.isLoading ? (
            <div className="space-y-2" aria-busy="true">
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
            </div>
          ) : (groups ?? []).length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              {item?.name} has no option groups yet. Add one — a cashier will be asked to choose
              from it every time this dish is rung.
            </p>
          ) : (
            (groups ?? []).map((group) => (
              <GroupCard
                key={group.id}
                group={group}
                menuItemId={item?.id ?? ""}
                onDelete={() =>
                  deleteGroup.mutate(
                    { groupId: group.id, menuItemId: item?.id ?? "" },
                    {
                      onSuccess: () => toast.success(`Removed “${group.name}”`),
                      onError: (error) =>
                        toast.error(error.message || "Could not remove the group."),
                    },
                  )
                }
                onToggleActive={() =>
                  updateGroup.mutate(
                    {
                      groupId: group.id,
                      menuItemId: item?.id ?? "",
                      input: {
                        name: group.name,
                        required: group.required,
                        minSelect: group.minSelect,
                        maxSelect: group.maxSelect,
                        sortOrder: group.sortOrder,
                        active: !group.active,
                      },
                    },
                    {
                      onSuccess: () =>
                        toast.success(
                          group.active ? `Retired “${group.name}”` : `Restored “${group.name}”`,
                        ),
                      onError: (error) =>
                        toast.error(error.message || "Could not update the group."),
                    },
                  )
                }
              />
            ))
          )}

          {showNewGroup ? (
            <div
              className="space-y-3 rounded-lg border border-dashed p-3"
              data-testid="new-group-form"
            >
              <div className="space-y-1">
                <Label htmlFor="modifier-group-name">Group name</Label>
                <Input
                  id="modifier-group-name"
                  value={groupName}
                  autoFocus
                  onChange={(e) => {
                    setGroupName(e.target.value);
                    if (groupError) setGroupError(null);
                  }}
                  placeholder="Spice level"
                  aria-invalid={groupError !== null && groupName.trim() === ""}
                />
              </div>

              <div className="flex flex-wrap items-end gap-3">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    data-testid="new-group-required"
                    checked={groupRequired}
                    onChange={(e) => {
                      const next = e.target.checked;
                      setGroupRequired(next);
                      // The two fields are the same fact, so ticking Required moves the minimum
                      // with it. The server refuses the contradiction; making the manager fix it by
                      // hand would be a rule they have to learn rather than a form that behaves.
                      setGroupMin(next ? (Number(groupMin) < 1 ? "1" : groupMin) : "0");
                      if (groupError) setGroupError(null);
                    }}
                    className="size-4 rounded border-input"
                  />
                  Required
                </label>
                <div className="space-y-1">
                  <Label htmlFor="modifier-group-min">Choose at least</Label>
                  <Input
                    id="modifier-group-min"
                    type="number"
                    min={0}
                    className="w-24"
                    value={groupMin}
                    onChange={(e) => {
                      setGroupMin(e.target.value);
                      setGroupRequired(Number(e.target.value) >= 1);
                      if (groupError) setGroupError(null);
                    }}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="modifier-group-max">at most</Label>
                  <Input
                    id="modifier-group-max"
                    type="number"
                    min={1}
                    className="w-24"
                    value={groupMax}
                    onChange={(e) => {
                      setGroupMax(e.target.value);
                      if (groupError) setGroupError(null);
                    }}
                  />
                </div>
              </div>

              <p className="text-xs text-muted-foreground">
                A cashier will be asked to choose{" "}
                {modifierGroupRule({
                  minSelect: Number(groupMin) || 0,
                  maxSelect: Number(groupMax) || 1,
                })}
                {groupRequired ? ", and cannot add the dish without it." : "."}
              </p>

              {groupError && (
                <p role="alert" data-testid="new-group-error" className="text-xs text-destructive">
                  {groupError}
                </p>
              )}

              <div className="flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  data-testid="new-group-save"
                  onClick={submitGroup}
                  disabled={createGroup.isPending}
                >
                  {createGroup.isPending ? "Adding…" : "Add group"}
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={resetGroupForm}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <Button
              type="button"
              variant="outline"
              size="sm"
              data-testid="add-modifier-group"
              onClick={() => setShowNewGroup(true)}
            >
              <Plus className="size-3.5" aria-hidden="true" />
              Add option group
            </Button>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function GroupCard({
  group,
  menuItemId,
  onDelete,
  onToggleActive,
}: {
  group: ModifierGroup;
  menuItemId: string;
  onDelete: () => void;
  onToggleActive: () => void;
}) {
  const createOption = useCreateModifierOption();
  const deleteOption = useDeleteModifierOption();
  const [showNew, setShowNew] = useState(false);
  const [name, setName] = useState("");
  const [price, setPrice] = useState("0");
  const [error, setError] = useState<string | null>(null);

  function submit() {
    const trimmed = name.trim();
    if (trimmed === "") {
      setError("Name this option — “Extra cheese”, “Hot”, “No onions”.");
      return;
    }
    const parsed = parseRupees(price);
    if ("error" in parsed) {
      setError(parsed.error);
      return;
    }
    setError(null);
    createOption.mutate(
      { groupId: group.id, menuItemId, input: { name: trimmed, priceDeltaPaisa: parsed.paisa } },
      {
        onSuccess: () => {
          toast.success(`Added “${trimmed}” to ${group.name}`);
          setName("");
          setPrice("0");
          setShowNew(false);
        },
        onError: (e) => setError(e.message || "Could not add the option."),
      },
    );
  }

  return (
    <div
      className={cn("rounded-lg border p-3", !group.active && "opacity-60")}
      data-testid={`manage-group-${group.id}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-sm font-medium">
            {group.name}
            {group.required ? (
              <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[11px] font-medium text-primary">
                Required
              </span>
            ) : null}
            {!group.active ? <StatusBadge status="archived" label="Retired" /> : null}
          </p>
          <p className="text-xs text-muted-foreground">
            Choose {modifierGroupRule(group)} · {group.optionCount}{" "}
            {group.optionCount === 1 ? "option" : "options"}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onToggleActive}
            aria-label={group.active ? `Retire ${group.name}` : `Restore ${group.name}`}
          >
            <Pencil className="size-3.5" aria-hidden="true" />
            {group.active ? "Retire" : "Restore"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={onDelete}
            aria-label={`Remove ${group.name}`}
          >
            <Trash2 className="size-3.5" aria-hidden="true" />
          </Button>
        </div>
      </div>

      <ul className="mt-2 space-y-1">
        {group.options.length === 0 ? (
          <li className="text-xs text-muted-foreground">
            No options yet — a cashier would be shown an empty group.
          </li>
        ) : (
          group.options.map((option) => (
            <li
              key={option.id}
              className="flex items-center gap-2 rounded border px-2 py-1 text-sm"
              data-testid={`manage-option-${option.id}`}
            >
              <span className="flex-1 truncate">{option.name}</span>
              {!option.active ? <StatusBadge status="archived" label="Retired" /> : null}
              <span className="shrink-0 font-mono text-xs text-muted-foreground">
                {option.priceDeltaPaisa === 0 ? (
                  "Free"
                ) : (
                  <>
                    {option.priceDeltaPaisa > 0 ? "+" : "−"}
                    <MoneyDisplay paisa={Math.abs(option.priceDeltaPaisa)} className="text-xs" />
                  </>
                )}
              </span>
              <button
                type="button"
                onClick={() =>
                  deleteOption.mutate(
                    { modifierId: option.id, menuItemId },
                    {
                      onSuccess: () => toast.success(`Removed “${option.name}”`),
                      onError: (e) => toast.error(e.message || "Could not remove the option."),
                    },
                  )
                }
                aria-label={`Remove ${option.name}`}
                className="flex min-h-[28px] min-w-[28px] items-center justify-center rounded text-muted-foreground hover:text-destructive"
              >
                <X className="size-3.5" aria-hidden="true" />
              </button>
            </li>
          ))
        )}
      </ul>

      {showNew ? (
        <div className="mt-2 space-y-2 rounded border border-dashed p-2">
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-[10rem] flex-1 space-y-1">
              <Label htmlFor={`option-name-${group.id}`}>Option name</Label>
              <Input
                id={`option-name-${group.id}`}
                value={name}
                autoFocus
                onChange={(e) => {
                  setName(e.target.value);
                  if (error) setError(null);
                }}
                placeholder="Extra cheese"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor={`option-price-${group.id}`}>Adds (Rs)</Label>
              <Input
                id={`option-price-${group.id}`}
                className="w-28"
                value={price}
                inputMode="decimal"
                onChange={(e) => {
                  setPrice(e.target.value);
                  if (error) setError(null);
                }}
              />
            </div>
          </div>
          {error && (
            <p
              role="alert"
              data-testid={`option-error-${group.id}`}
              className="text-xs text-destructive"
            >
              {error}
            </p>
          )}
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              data-testid={`save-option-${group.id}`}
              onClick={submit}
              disabled={createOption.isPending}
            >
              {createOption.isPending ? "Adding…" : "Add option"}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setShowNew(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="mt-1"
          data-testid={`add-option-${group.id}`}
          onClick={() => setShowNew(true)}
        >
          <Plus className="size-3.5" aria-hidden="true" />
          Add option
        </Button>
      )}
    </div>
  );
}
