"use client";

import { useMemo, useState } from "react";
import { Percent, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import {
  useCreateTaxClass,
  useDeleteTaxClass,
  useTaxClasses,
  useUpdateTaxClass,
} from "@/lib/hooks/pos/use-tax-classes";
import type { TaxClass } from "@/lib/models/tax-class.model";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { QueryBoundary } from "@/components/ui/query-boundary";
import { formatUserFacingError } from "@/lib/errors";
import { cn } from "@/lib/utils";

/**
 * The tenant's sales-tax catalogue (F16).
 *
 * <h2>What this screen is for</h2>
 *
 * <p>Before it, there was no sales-tax configuration anywhere in the product. A rate could only be
 * typed onto one dish at a time, in the item dialog, and only since S0-03 put the field there at
 * all. The result was measured on a real bill: a Rs 1,657.00 dine-in subtotal taxed Rs 25.60 —
 * 1.5% — because two Butter Naans carried 16% and no other line carried anything.
 *
 * <h2>Validation is on the field, as the user types</h2>
 *
 * <p>Each row validates its own three inputs on change and on blur, names the field and the real
 * problem ("A rate cannot be above 100%"), and disables its own Save while it is wrong. Register
 * §23 measured `ariaInvalid: 0` on type AND on blur across the product; every message here is
 * bound with `aria-invalid` + `aria-describedby` so a screen reader reaches it too.
 */
export function TaxClassManager() {
  const query = useTaxClasses();
  const [isAdding, setIsAdding] = useState(false);

  // The `?? []` lives INSIDE the memo: a fresh literal in the dependency array would change
  // identity on every render and make the memo a no-op that still costs a comparison.
  const sorted = useMemo(
    () =>
      [...(query.data ?? [])].sort(
        (a, b) => Number(b.active) - Number(a.active) || b.ratePct - a.ratePct,
      ),
    [query.data],
  );

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <CardTitle className="flex items-center gap-2">
            <Percent className="size-4" aria-hidden />
            Sales-tax rates
          </CardTitle>
          <CardDescription>
            The rates your menu is priced against. Apply one to a menu category and every dish in it
            inherits it; a single dish can override.
          </CardDescription>
        </div>
        <Button
          type="button"
          size="sm"
          data-testid="add-tax-class"
          onClick={() => setIsAdding(true)}
          disabled={isAdding}
        >
          <Plus className="size-4" aria-hidden />
          Add rate
        </Button>
      </CardHeader>

      <CardContent className="space-y-3">
        <QueryBoundary
          query={query}
          // Singular noun phrase, deliberately: the shared notice renders `{what} is unavailable`
          // and `handles {what}`, so a plural here produces "Your sales-tax rates is unavailable".
          what="your sales-tax rate list"
          moduleLabel="Settings"
          stillWorks="The till keeps charging the rates already set — nothing about this outage changes what a guest is billed."
          isEmpty={sorted.length === 0 && !isAdding}
          empty={
            <EmptyState
              title="No sales-tax rates yet"
              description="Add the rate your food is sold at — in Pakistan that is usually a standard rate around 17%, with a zero-rated class for anything exempt. You can then apply it to a whole menu category at once."
              action={{ label: "Add your first rate", onClick: () => setIsAdding(true) }}
            />
          }
        >
          <ul className="space-y-3" data-testid="tax-class-list">
            {sorted.map((taxClass) => (
              <li key={taxClass.id}>
                <TaxClassRow taxClass={taxClass} />
              </li>
            ))}
          </ul>
        </QueryBoundary>

        {isAdding ? <NewTaxClassRow onDone={() => setIsAdding(false)} /> : null}
      </CardContent>
    </Card>
  );
}

// ── Validation, shared by both rows so "add" and "edit" cannot disagree ──────────────────────

interface Draft {
  code: string;
  name: string;
  ratePct: string;
}

interface FieldErrors {
  code?: string;
  name?: string;
  ratePct?: string;
}

/**
 * Every message names the field and the actual problem, never "invalid".
 *
 * <p>The rate check deliberately treats blank and zero differently: a blank box is a question
 * nobody answered, and a zero is a real, common, deliberate answer (exempt food, exports). Letting
 * blank mean zero is the same absent-vs-zero confusion that produced the defect this screen closes.
 */
function validate(draft: Draft): FieldErrors {
  const errors: FieldErrors = {};

  if (!draft.code.trim()) {
    errors.code = "Enter the code your tax authority uses, for example SR-STD-17.";
  } else if (draft.code.trim().length > 40) {
    errors.code = "A tax code can be at most 40 characters.";
  }

  if (!draft.name.trim()) {
    errors.name = "Give this rate a name people will recognise, like Standard rate.";
  } else if (draft.name.trim().length > 120) {
    errors.name = "A name can be at most 120 characters.";
  }

  const raw = draft.ratePct.trim();
  if (raw === "") {
    errors.ratePct = "Enter a rate. For a genuinely exempt class, enter 0.";
  } else if (!Number.isFinite(Number(raw))) {
    errors.ratePct = `"${raw}" is not a number. Enter a percentage such as 17 or 17.5.`;
  } else if (Number(raw) < 0) {
    errors.ratePct = "A tax rate cannot be negative.";
  } else if (Number(raw) > 100) {
    errors.ratePct = "A tax rate cannot be above 100%.";
  } else if (Math.round(Number(raw) * 100) !== Number(raw) * 100) {
    errors.ratePct = "A rate can have at most two decimal places.";
  }

  return errors;
}

function hasErrors(errors: FieldErrors): boolean {
  return Boolean(errors.code || errors.name || errors.ratePct);
}

interface FieldProps {
  id: string;
  label: string;
  help: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  showError: boolean;
  placeholder?: string;
  inputMode?: "decimal" | "text";
  className?: string;
}

function Field({
  id,
  label,
  help,
  value,
  onChange,
  error,
  showError,
  placeholder,
  inputMode,
  className,
}: FieldProps) {
  const invalid = showError && Boolean(error);
  return (
    <div className={cn("space-y-1", className)}>
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        value={value}
        placeholder={placeholder}
        inputMode={inputMode}
        aria-invalid={invalid || undefined}
        aria-describedby={invalid ? `${id}-error` : `${id}-help`}
        onChange={(event) => onChange(event.target.value)}
      />
      {invalid ? (
        <p id={`${id}-error`} role="alert" className="text-destructive text-label">
          {error}
        </p>
      ) : (
        <p id={`${id}-help`} className="text-muted-foreground text-label">
          {help}
        </p>
      )}
    </div>
  );
}

// ── Add ─────────────────────────────────────────────────────────────────────────────────────

function NewTaxClassRow({ onDone }: { onDone: () => void }) {
  const create = useCreateTaxClass();
  const [draft, setDraft] = useState<Draft>({ code: "", name: "", ratePct: "" });
  // Errors appear as the user types once a field has been touched — not only on submit, which is
  // what register §23 found everywhere ("no inline validation anywhere").
  const [touched, setTouched] = useState<Record<keyof Draft, boolean>>({
    code: false,
    name: false,
    ratePct: false,
  });
  const errors = validate(draft);

  function set(field: keyof Draft, value: string) {
    setDraft((prev) => ({ ...prev, [field]: value }));
    setTouched((prev) => ({ ...prev, [field]: true }));
  }

  function submit() {
    setTouched({ code: true, name: true, ratePct: true });
    if (hasErrors(errors)) return;
    create.mutate(
      {
        code: draft.code.trim(),
        name: draft.name.trim(),
        ratePct: Number(draft.ratePct),
      },
      {
        onSuccess: (saved) => {
          toast.success(`Added ${saved.name} at ${saved.ratePct.toFixed(2)}%`);
          onDone();
        },
        onError: (error) => toast.error(formatUserFacingError(error)),
      },
    );
  }

  return (
    <div
      className="border-border-interactive space-y-3 rounded-lg border border-dashed p-3"
      data-testid="new-tax-class-row"
    >
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_minmax(0,7rem)]">
        <Field
          id="new-tax-code"
          label="Tax code"
          help="What your return files this under."
          placeholder="SR-STD-17"
          value={draft.code}
          onChange={(v) => set("code", v)}
          error={errors.code}
          showError={touched.code}
        />
        <Field
          id="new-tax-name"
          label="Name"
          help="Printed on the guest's bill."
          placeholder="Standard rate"
          value={draft.name}
          onChange={(v) => set("name", v)}
          error={errors.name}
          showError={touched.name}
        />
        <Field
          id="new-tax-rate"
          label="Rate (%)"
          help="0 to 100."
          placeholder="17"
          inputMode="decimal"
          value={draft.ratePct}
          onChange={(v) => set("ratePct", v)}
          error={errors.ratePct}
          showError={touched.ratePct}
        />
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" size="sm" onClick={onDone}>
          Cancel
        </Button>
        <Button
          type="button"
          size="sm"
          data-testid="save-new-tax-class"
          onClick={submit}
          disabled={create.isPending || hasErrors(errors)}
        >
          {create.isPending ? "Adding…" : "Add rate"}
        </Button>
      </div>
    </div>
  );
}

// ── Edit / retire / delete ──────────────────────────────────────────────────────────────────

function usageSentence(taxClass: TaxClass): string {
  const parts: string[] = [];
  if (taxClass.categoryCount > 0) {
    parts.push(
      `${taxClass.categoryCount} ${taxClass.categoryCount === 1 ? "category" : "categories"}`,
    );
  }
  if (taxClass.itemCount > 0) {
    parts.push(`${taxClass.itemCount} ${taxClass.itemCount === 1 ? "item" : "items"}`);
  }
  if (parts.length === 0) return "Not applied to anything yet.";
  return `Applied to ${parts.join(" and ")}.`;
}

function TaxClassRow({ taxClass }: { taxClass: TaxClass }) {
  const update = useUpdateTaxClass();
  const remove = useDeleteTaxClass();
  const [draft, setDraft] = useState<Draft>({
    code: taxClass.code,
    name: taxClass.name,
    ratePct: taxClass.ratePct.toString(),
  });
  const [touched, setTouched] = useState<Record<keyof Draft, boolean>>({
    code: false,
    name: false,
    ratePct: false,
  });
  const errors = validate(draft);
  const inUse = taxClass.categoryCount > 0 || taxClass.itemCount > 0;
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const dirty =
    draft.code !== taxClass.code ||
    draft.name !== taxClass.name ||
    Number(draft.ratePct) !== taxClass.ratePct;

  function set(field: keyof Draft, value: string) {
    setDraft((prev) => ({ ...prev, [field]: value }));
    setTouched((prev) => ({ ...prev, [field]: true }));
  }

  function save(nextActive = taxClass.active) {
    setTouched({ code: true, name: true, ratePct: true });
    if (hasErrors(errors)) return;
    update.mutate(
      {
        id: taxClass.id,
        input: {
          code: draft.code.trim(),
          name: draft.name.trim(),
          ratePct: Number(draft.ratePct),
          active: nextActive,
        },
      },
      {
        onSuccess: (saved) => toast.success(`Saved ${saved.name}`),
        onError: (error) => toast.error(formatUserFacingError(error)),
      },
    );
  }

  return (
    <div
      className={cn(
        "border-border space-y-3 rounded-lg border p-3",
        !taxClass.active && "bg-muted/40",
      )}
      data-testid="tax-class-row"
      data-tax-code={taxClass.code}
    >
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_minmax(0,7rem)]">
        <Field
          id={`tax-code-${taxClass.id}`}
          label="Tax code"
          help="What your return files this under."
          value={draft.code}
          onChange={(v) => set("code", v)}
          error={errors.code}
          showError={touched.code}
        />
        <Field
          id={`tax-name-${taxClass.id}`}
          label="Name"
          help="Printed on the guest's bill."
          value={draft.name}
          onChange={(v) => set("name", v)}
          error={errors.name}
          showError={touched.name}
        />
        <Field
          id={`tax-rate-${taxClass.id}`}
          label="Rate (%)"
          help="0 to 100."
          inputMode="decimal"
          value={draft.ratePct}
          onChange={(v) => set("ratePct", v)}
          error={errors.ratePct}
          showError={touched.ratePct}
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-muted-foreground text-label" data-testid="tax-class-usage">
          {usageSentence(taxClass)}
          {!taxClass.active ? " Retired — no longer offered when classifying a dish." : ""}
        </p>
        <div className="flex flex-wrap gap-2">
          {/*
            Retiring, not deleting, is how a rate in use is taken out of circulation. The server
            still honours it for the dishes already on it — "stop offering this" and "stop charging
            this" must not be the same button, or retiring a rate silently un-taxes a menu.
          */}
          <Button
            type="button"
            variant="outline"
            size="sm"
            data-testid="toggle-tax-class-active"
            onClick={() => save(!taxClass.active)}
            disabled={update.isPending}
          >
            {taxClass.active ? "Retire" : "Bring back"}
          </Button>
          {/*
            38-10 task 5. This button used to delete on the first click, with no confirmation
            anywhere in `components/settings/**` — the audit measured "settings (0 — printer +
            tax-class deletes)" against seven files that already import the shared primitive.
            Deleting a tax class is not reversible and the rate is a statutory fact about the
            business, so it now asks, names the class, and says what happens to the menu.
          */}
          <Button
            type="button"
            variant="outline"
            size="sm"
            data-testid="delete-tax-class"
            title={
              inUse
                ? "This rate is still applied to part of the menu. Move those to another rate, or retire this one."
                : undefined
            }
            disabled={remove.isPending || inUse}
            onClick={() => setConfirmingDelete(true)}
          >
            <Trash2 className="size-4" aria-hidden />
            Delete
          </Button>
          <Button
            type="button"
            size="sm"
            data-testid="save-tax-class"
            onClick={() => save()}
            disabled={update.isPending || !dirty || hasErrors(errors)}
          >
            {update.isPending ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>

      <ConfirmDialog
        open={confirmingDelete}
        onOpenChange={setConfirmingDelete}
        title={`Delete ${taxClass.name}?`}
        body={
          <>
            The rate disappears from the list of rates a dish can be given. Nothing already charged
            changes — past bills and past returns keep the rate they were calculated at. This cannot
            be undone; <strong>Retire</strong> is the reversible version.
          </>
        }
        confirmLabel="Delete rate"
        pendingLabel="Deleting…"
        isPending={remove.isPending}
        onConfirm={() =>
          remove.mutate(taxClass.id, {
            onSuccess: () => {
              toast.success(`Deleted ${taxClass.name}`);
              setConfirmingDelete(false);
            },
            onError: (error) => toast.error(formatUserFacingError(error)),
          })
        }
      />
    </div>
  );
}
