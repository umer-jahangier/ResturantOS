"use client";

import { useState } from "react";
import { ChevronDown, RefreshCw, Wallet } from "lucide-react";
import { toast } from "sonner";
import { MoneyDisplay } from "@/components/ui/money-display";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { PermissionGuard } from "@/components/shared/permission-guard";
import { formatPaisa, parseRupeesToPaisa } from "@/lib/adapters/shared";
import { EmptyState } from "@/components/ui/empty-state";
import { QueryBoundary, QueryErrorNotice } from "@/components/ui/query-boundary";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  useBranchTills,
  useTillReconciliation,
  useTillReviewActions,
  useApproveTill,
  useFlagTill,
  useAddTillNote,
  useEligibleCashiers,
  useOpenTillForCashier,
} from "@/lib/hooks/pos/use-till";
import { useCurrentUser } from "@/lib/hooks/auth/use-current-user";
import type { TillSession, TillReviewStatus } from "@/lib/models/pos.model";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 20;

/**
 * Review state, in semantic tokens rather than raw Tailwind palette literals (G3).
 *
 * <p>`bg-amber-500/15 text-amber-600` and friends followed neither the theme nor `--brand-h`,
 * and `text-amber-600` measures ~3:1 on a light surface — under the 4.5:1 SC 1.4.3 needs for
 * the one word on a cash-reconciliation screen that says whether a drawer is still in dispute.
 *
 * <p>`--success` and `--destructive` FLIP with the theme (`success-600`/`danger-600` light,
 * `success-400`/`danger-400` dark), so `text-success` / `text-destructive` are legible in both
 * — the pairs are asserted in `design-tokens.test.ts`. `--warning` does NOT flip: it is
 * `warning-400` in both themes, a light amber that reads fine on a dark surface and fails on a
 * light one, so the pending badge names the ramp step per theme instead. Same shape as
 * `components/ui/activity-row.tsx`.
 *
 * <p>D-38-13 §4.2: none of these carries state by hue alone — the badge prints the status word
 * ("PENDING REVIEW", "APPROVED", "FLAGGED") beside the colour.
 */
const REVIEW_BADGE: Record<TillReviewStatus, string> = {
  PENDING_REVIEW: "bg-warning/15 text-warning-700 dark:text-warning-400",
  APPROVED: "bg-success/15 text-success",
  FLAGGED: "bg-destructive/15 text-destructive",
};

function fmtTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
}

/**
 * Manager/owner till review: a paginated table of the branch's till sessions (opening/closing,
 * cashier, float, expected/declared/variance, review state) that expands into the session's
 * orders + cash collected and its review history. Closed sessions can be approved, flagged, or
 * annotated — every action is recorded server-side as an append-only review record.
 */
export function TillReview() {
  const { branchId } = useCurrentUser();
  const [page, setPage] = useState(0);
  const tillsQuery = useBranchTills(branchId, page, PAGE_SIZE);
  const { data, isFetching, refetch } = tillsQuery;
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const tills = data?.data ?? [];
  const totalCount = data?.meta?.totalCount ?? 0;
  const hasNext = Boolean(data?.meta?.page?.nextCursor);

  return (
    <div className="flex h-full flex-col gap-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-semibold">Till Review</h1>
        <div className="flex items-center gap-2">
          {/* F11. Only for the people who may actually hand a drawer over — the same permission
              pos-service gates the endpoint on, so the button never appears where it would 403. */}
          <PermissionGuard require="pos.till.open.other">
            <OpenDrawerForCashier branchId={branchId} />
          </PermissionGuard>
          <button
            type="button"
            onClick={() => void refetch()}
            disabled={isFetching}
            className="inline-flex items-center gap-1.5 rounded-full border px-3 py-2 text-xs font-medium text-muted-foreground hover:bg-muted disabled:opacity-60"
          >
            <RefreshCw className={cn("size-3.5", isFetching && "animate-spin")} aria-hidden="true" />
            Refresh
          </button>
        </div>
      </div>

      {/* GA-001: "No till sessions yet" was the early return for BOTH an empty branch and a
          pos-service failure. On a cash-reconciliation screen that is the worst possible
          conflation — a manager looking for a variance is told there is nothing to reconcile.
          The header stays mounted in every state so Refresh is always reachable. */}
      <QueryBoundary
        query={tillsQuery}
        what="till sessions"
        isEmpty={tills.length === 0 && page === 0}
        empty={
          <EmptyState
            title="No till sessions yet"
            description="Opened and closed tills appear here for review."
          />
        }
      >
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left">Opened</th>
                <th className="px-3 py-2 text-left">Closed</th>
                <th className="px-3 py-2 text-left">Cashier</th>
                <th className="px-3 py-2 text-left">Status</th>
                <th className="px-3 py-2 text-left">Review</th>
                <th className="px-3 py-2 text-right">Float</th>
                <th className="px-3 py-2 text-right">Expected</th>
                <th className="px-3 py-2 text-right">Declared</th>
                <th className="px-3 py-2 text-right">Variance</th>
                <th className="px-3 py-2 text-right">Actions</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {tills.map((till) => (
                <TillRow
                  key={till.id}
                  till={till}
                  branchId={branchId}
                  expanded={selectedId === till.id}
                  onToggle={() => setSelectedId(selectedId === till.id ? null : till.id)}
                />
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span data-testid="till-review-page-info">
            Page {page + 1} · {totalCount} session{totalCount === 1 ? "" : "s"} total
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              data-testid="till-review-prev"
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0 || isFetching}
              className="rounded-full border px-3 py-2 font-medium hover:bg-muted disabled:opacity-60"
            >
              Previous
            </button>
            <button
              type="button"
              data-testid="till-review-next"
              onClick={() => setPage((p) => p + 1)}
              disabled={!hasNext || isFetching}
              className="rounded-full border px-3 py-2 font-medium hover:bg-muted disabled:opacity-60"
            >
              Next
            </button>
          </div>
        </div>
      </QueryBoundary>
    </div>
  );
}

/**
 * The duty manager counts a float and hands the drawer over (F11).
 *
 * <h2>What this replaces</h2>
 *
 * <p>Nothing — there was no way to do it. `openTill` bound the session to whoever pressed the
 * button, so the manager who counted a Rs 5,000.00 float opened THEIR OWN drawer and the cashier's
 * terminal still read "No active till" (walkthrough §0). Every cashier had to count their own
 * float, which is not how cash custody works in a restaurant.
 *
 * <h2>Why it lives on Till Review and not on the POS strip</h2>
 *
 * <p>The POS strip is session-scoped: it shows the CALLER's drawer and only offers "Open Till"
 * when the caller has none. A duty manager who already has their own drawer open would therefore
 * never see the affordance at the moment they need it, and a manager who does not use a terminal
 * would never see it at all. Till Review is the branch-wide, supervisor-scoped screen and is
 * already where somebody else's drawer is dealt with.
 */
function OpenDrawerForCashier({ branchId }: { branchId: string }) {
  const [open, setOpen] = useState(false);
  const [cashierId, setCashierId] = useState("");
  const [float, setFloat] = useState("");
  const [submitError, setSubmitError] = useState<string | null>(null);

  const cashiersQuery = useEligibleCashiers(branchId, open);
  const openTill = useOpenTillForCashier();

  const cashiers = cashiersQuery.data ?? [];
  const selected = cashiers.find((c) => c.userId === cashierId) ?? null;

  // Validation as the manager types (§22), and the money boundary crossed exactly once.
  //
  // `parseRupeesToPaisa` is the app's single rupee→paisa site: BigInt digit arithmetic, HALF_UP,
  // never a binary float near money. It also refuses a negative outright, which is why there is no
  // separate `< 0` branch here. A hand-rolled `Math.round(parseFloat(x) * 100)` would be a second
  // rounding rule AND the float this codebase forbids near money.
  const floatTrimmed = float.trim();
  const floatPaisa = floatTrimmed === "" ? null : parseRupeesToPaisa(floatTrimmed);
  const floatError =
    floatTrimmed !== "" && floatPaisa === null
      ? "Opening float must be an amount in rupees, for example 5000.00 — no negatives"
      : null;
  const cashierError =
    cashierId !== "" && selected?.hasOpenTill
      ? `${selected.name} already has an open till. Cash that drawer up before opening another one for them.`
      : null;

  const canSubmit =
    cashierId !== "" && floatPaisa !== null && floatError === null && cashierError === null;

  const reset = () => {
    setCashierId("");
    setFloat("");
    setSubmitError(null);
  };

  const submit = () => {
    if (!canSubmit || floatPaisa === null) return;
    setSubmitError(null);
    openTill.mutate(
      { branchId, openingFloatPaisa: floatPaisa, cashierId },
      {
        onSuccess: () => {
          toast.success(
            `Till opened for ${selected?.name ?? "the cashier"} with a ${formatPaisa(floatPaisa)} float.`,
          );
          setOpen(false);
          reset();
        },
        // The server's own message is the useful one here — "Shift Cashier already has an open
        // till", "…their role here does not allow running a cash drawer" — so it is shown rather
        // than replaced with a generic failure (§27).
        onError: (e) =>
          setSubmitError(
            e.message ?? "The till could not be opened. Check the details and try again.",
          ),
      },
    );
  };

  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="outline"
        data-testid="open-drawer-for-cashier-button"
        onClick={() => setOpen(true)}
      >
        <Wallet className="size-3.5" aria-hidden="true" />
        Open a drawer
      </Button>

      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) reset();
        }}
      >
        <DialogContent data-testid="open-drawer-panel">
          <DialogHeader>
            <DialogTitle>Open a drawer for a cashier</DialogTitle>
            <DialogDescription>
              Count the float into the drawer, then hand it over. The till belongs to the cashier
              you name — they settle against it and they cash it up.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="open-drawer-cashier">Cashier</Label>
              <Select
                id="open-drawer-cashier"
                data-testid="open-drawer-cashier-select"
                placeholder="Choose who the drawer is for"
                options={cashiers.map((c) => ({
                  value: c.userId,
                  label: c.hasOpenTill
                    ? `${c.name} — ${c.roleCode.toLowerCase()} (already has a drawer)`
                    : `${c.name} — ${c.roleCode.toLowerCase()}`,
                }))}
                value={cashierId}
                onValueChange={(v) => setCashierId(v)}
                isLoading={cashiersQuery.isPending}
                error={cashiersQuery.isError}
                onRetry={() => void cashiersQuery.refetch()}
                aria-invalid={cashierError !== null}
                aria-describedby={cashierError ? "open-drawer-cashier-error" : undefined}
              />
              {/* An empty roster is NOT an error and must not read as one (§26). */}
              {!cashiersQuery.isPending && !cashiersQuery.isError && cashiers.length === 0 && (
                <p
                  data-testid="open-drawer-no-cashiers"
                  className="text-xs text-muted-foreground"
                >
                  Nobody at this branch can run a cash drawer yet. Give someone a cashier role in
                  Users first, then open their drawer here.
                </p>
              )}
              {cashierError && (
                <p
                  id="open-drawer-cashier-error"
                  data-testid="open-drawer-cashier-error"
                  className="text-xs text-destructive"
                >
                  {cashierError}
                </p>
              )}
              {selected && !selected.hasOpenTill && (
                <p className="text-xs text-muted-foreground">{selected.email}</p>
              )}
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="open-drawer-float">Opening float (PKR)</Label>
              <Input
                id="open-drawer-float"
                data-testid="open-drawer-float-input"
                /*
                 * TEXT, not `type="number"` — deliberately, and for the reason recorded on
                 * `parseRupeesToPaisa`: a number input blanks its own `.value` on the intermediate
                 * "5000." keystroke, so the digits that follow land against an emptied field. That
                 * is how the Charge screen once turned a Rs 3,456.80 tender into Rs 345.60.
                 */
                type="text"
                inputMode="decimal"
                autoComplete="off"
                placeholder="e.g. 5000.00"
                value={float}
                onChange={(e) => setFloat(e.target.value)}
                aria-invalid={floatError !== null}
                aria-describedby={floatError ? "open-drawer-float-error" : undefined}
              />
              {floatError && (
                <p
                  id="open-drawer-float-error"
                  data-testid="open-drawer-float-error"
                  className="text-xs text-destructive"
                >
                  {floatError}
                </p>
              )}
            </div>

            {/* The sentence the manager is signing off, written out before they press anything. */}
            {canSubmit && floatPaisa !== null && selected && (
              <p
                data-testid="open-drawer-summary"
                role="status"
                aria-live="polite"
                className="rounded-lg bg-muted/50 px-3 py-2 text-sm"
              >
                Counting <MoneyDisplay paisa={floatPaisa} className="font-medium" /> into{" "}
                <span className="font-medium">{selected.name}</span>&apos;s drawer.
              </p>
            )}

            {submitError && (
              <p
                data-testid="open-drawer-error"
                role="alert"
                className="text-xs text-destructive"
              >
                {submitError}
              </p>
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              data-testid="open-drawer-confirm-button"
              disabled={!canSubmit || openTill.isPending}
              onClick={submit}
            >
              {openTill.isPending ? "Opening…" : "Open drawer"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function TillRow({
  till,
  branchId,
  expanded,
  onToggle,
}: {
  till: TillSession;
  branchId: string;
  expanded: boolean;
  onToggle: () => void;
}) {
  const variance = till.variancePaisa;
  return (
    <>
      <tr className="hover:bg-muted/30">
        <td className="px-3 py-2">{fmtTime(till.openedAt)}</td>
        <td className="px-3 py-2">{fmtTime(till.closedAt)}</td>
        {/*
          F21. This printed `cashierId.slice(0, 8)` — a column of "4fdc85ef", "4b9941f7",
          "eb2ee67e" on the one screen whose whole job is answering "whose drawer was Rs 200
          short". The name now comes down on the row itself (TillServiceImpl resolves it through
          StaffNameDirectory); the id stays the fallback, because a directory outage must cost the
          name and not the attribution.
        */}
        <td className="px-3 py-2" data-testid={`till-cashier-${till.id}`}>
          {till.cashierName ? (
            <span className="text-sm">{till.cashierName}</span>
          ) : (
            <span
              className="font-mono text-xs text-muted-foreground"
              title="This person's name could not be looked up just now — this is their user id."
            >
              {till.cashierId.slice(0, 8)}
            </span>
          )}
        </td>
        <td className="px-3 py-2">
          <span
            className={cn(
              "rounded px-1.5 py-0.5 text-xs font-medium",
              till.status === "OPEN"
                ? "bg-success/15 text-success"
                : "bg-muted text-muted-foreground",
            )}
          >
            {till.status}
          </span>
        </td>
        <td className="px-3 py-2">
          <span
            className={cn(
              "rounded px-1.5 py-0.5 text-xs font-medium",
              REVIEW_BADGE[till.reviewStatus],
            )}
          >
            {till.reviewStatus.replace("_", " ")}
          </span>
        </td>
        <td className="px-3 py-2 text-right">
          <MoneyDisplay paisa={till.openingFloatPaisa} className="text-xs" />
        </td>
        <td className="px-3 py-2 text-right">
          {till.expectedClosingPaisa !== null ? (
            <MoneyDisplay paisa={till.expectedClosingPaisa} className="text-xs" />
          ) : (
            "—"
          )}
        </td>
        <td className="px-3 py-2 text-right">
          {till.declaredClosingPaisa !== null ? (
            <MoneyDisplay paisa={till.declaredClosingPaisa} className="text-xs" />
          ) : (
            "—"
          )}
        </td>
        <td
          className={cn(
            "px-3 py-2 text-right text-xs",
            // `text-destructive`, not `text-red-600` — it flips to `danger-400` in dark, where
            // the raw literal stayed a 4.7:1-on-black red. The shortfall is not signalled by
            // colour alone either way: `formatPaisa` already writes the leading minus, so
            // "-Rs 200.00" reads as short in greyscale (D-38-13 §4.2).
            variance !== null && variance < 0 && "text-destructive",
          )}
        >
          {variance !== null ? <MoneyDisplay paisa={variance} className="text-xs" /> : "—"}
        </td>
        <td className="px-3 py-2 text-right">
          {till.status === "CLOSED" ? (
            <TillReviewActions till={till} branchId={branchId} />
          ) : (
            <span className="text-xs text-muted-foreground">—</span>
          )}
        </td>
        <td className="px-3 py-2 text-right">
          <button
            type="button"
            onClick={onToggle}
            className="text-xs font-medium text-primary underline"
          >
            {expanded ? "Hide" : "Details"}
          </button>
        </td>
      </tr>
      {till.note && (
        <tr>
          <td colSpan={11} className="px-3 pb-2 text-xs text-muted-foreground">
            <span className="font-medium">Cashier note:</span> {till.note}
          </td>
        </tr>
      )}
      {expanded && (
        <tr>
          <td colSpan={11} className="bg-muted/20 px-3 py-3">
            <TillReconciliationDetail tillId={till.id} />
          </td>
        </tr>
      )}
    </>
  );
}

/**
 * Unreviewed tills get the decision buttons inline (approve/flag is the whole point of the
 * screen). Once a decision exists, those collapse into a single "Change status" menu that omits
 * the status the till is already in — re-offering "Approve" on an approved till is just noise.
 */
function TillReviewActions({ till, branchId }: { till: TillSession; branchId: string }) {
  const approve = useApproveTill();
  const flag = useFlagTill();
  const addNote = useAddTillNote();
  const [dialog, setDialog] = useState<"FLAG" | "NOTE" | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  const busy = approve.isPending || flag.isPending || addNote.isPending;
  const undecided = till.reviewStatus === "PENDING_REVIEW";

  const doApprove = () =>
    approve.mutate(
      { tillId: till.id, branchId },
      { onError: (e) => toast.error(e.message ?? "Failed to approve till session.") },
    );

  // Close the menu first, then open the dialog on the next frame — otherwise Radix's
  // close-auto-focus (returning focus to the trigger) races the dialog's focus trap.
  const openDialogFromMenu = (which: "FLAG" | "NOTE") => {
    setMenuOpen(false);
    requestAnimationFrame(() => setDialog(which));
  };

  return (
    <>
      {undecided ? (
        <div className="flex justify-end gap-1.5">
          <Button
            type="button"
            size="sm"
            variant="outline"
            data-testid="till-approve-button"
            disabled={busy}
            onClick={doApprove}
          >
            {approve.isPending ? "Approving…" : "Approve"}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="destructive"
            data-testid="till-flag-button"
            disabled={busy}
            onClick={() => setDialog("FLAG")}
          >
            Flag
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            data-testid="till-note-button"
            disabled={busy}
            onClick={() => setDialog("NOTE")}
          >
            Note
          </Button>
        </div>
      ) : (
        <div className="flex justify-end">
          <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                size="sm"
                variant="outline"
                data-testid="till-change-status-button"
                disabled={busy}
              >
                {busy ? "Saving…" : "Change status"}
                <ChevronDown className="size-3.5" aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {till.reviewStatus !== "APPROVED" && (
                <DropdownMenuItem onSelect={doApprove}>Approve</DropdownMenuItem>
              )}
              {till.reviewStatus !== "FLAGGED" && (
                <DropdownMenuItem onSelect={() => openDialogFromMenu("FLAG")}>
                  Flag
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => openDialogFromMenu("NOTE")}>
                Add note
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}

      <ReviewTextDialog
        open={dialog === "FLAG"}
        onOpenChange={(next) => setDialog(next ? "FLAG" : null)}
        title="Flag till session"
        description="A reason is required and is recorded on the till session."
        inputLabel="Flag reason"
        confirmLabel="Flag"
        confirmVariant="destructive"
        isPending={flag.isPending}
        onConfirm={(reason) =>
          flag.mutate(
            { tillId: till.id, branchId, reason },
            { onError: (e) => toast.error(e.message ?? "Failed to flag till session.") },
          )
        }
      />
      <ReviewTextDialog
        open={dialog === "NOTE"}
        onOpenChange={(next) => setDialog(next ? "NOTE" : null)}
        title="Add review note"
        description="Recorded on the till session's review history. Does not change its review status."
        inputLabel="Review note"
        confirmLabel="Add note"
        confirmVariant="default"
        isPending={addNote.isPending}
        onConfirm={(note) =>
          addNote.mutate(
            { tillId: till.id, branchId, note },
            { onError: (e) => toast.error(e.message ?? "Failed to add note.") },
          )
        }
      />
    </>
  );
}

/** Controlled — the caller owns `open` so both the inline buttons and the menu can drive it. */
function ReviewTextDialog({
  open,
  onOpenChange,
  title,
  description,
  inputLabel,
  confirmLabel,
  confirmVariant,
  isPending,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  title: string;
  description: string;
  inputLabel: string;
  confirmLabel: string;
  confirmVariant: "default" | "destructive";
  isPending: boolean;
  onConfirm: (text: string) => void;
}) {
  const [text, setText] = useState("");

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) setText("");
        onOpenChange(next);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <textarea
          aria-label={inputLabel}
          placeholder={inputLabel}
          maxLength={500}
          rows={3}
          value={text}
          onChange={(e) => setText(e.target.value)}
          className="w-full resize-none rounded border px-3 py-2 text-sm"
        />
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            variant={confirmVariant}
            disabled={isPending || text.trim().length === 0}
            onClick={() => {
              onConfirm(text.trim());
              onOpenChange(false);
            }}
          >
            {isPending ? "Saving…" : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TillReconciliationDetail({ tillId }: { tillId: string }) {
  const { data: recon, isLoading, isError, error, refetch } = useTillReconciliation(tillId);

  if (isLoading) return <p className="text-xs text-muted-foreground">Loading orders…</p>;
  // GA-001, same defect one level down: "No data." was also what a failed reconciliation fetch
  // rendered. On a cash count, "there were no orders" and "we could not read the orders" are
  // opposite conclusions.
  if (isError) {
    return (
      <QueryErrorNotice
        what="this session's reconciliation"
        error={error}
        onRetry={() => void refetch()}
      />
    );
  }
  if (!recon) return <p className="text-xs text-muted-foreground">No data.</p>;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-4 text-xs">
        <span>
          Orders: <span className="font-medium">{recon.orderCount}</span>
        </span>
        <span>
          Cash: <MoneyDisplay paisa={recon.cashCollectedPaisa} className="text-xs" />
        </span>
        <span>
          Non-cash: <MoneyDisplay paisa={recon.nonCashCollectedPaisa} className="text-xs" />
        </span>
        <span>
          Expected cash:{" "}
          <MoneyDisplay paisa={recon.liveExpectedCashPaisa} className="text-xs font-medium" />
        </span>
      </div>
      {recon.orders.length === 0 ? (
        <p className="text-xs text-muted-foreground">No orders in this till session.</p>
      ) : (
        <table className="w-full text-xs">
          <thead className="text-muted-foreground">
            <tr>
              <th className="py-1 text-left">Order</th>
              <th className="py-1 text-left">Status</th>
              <th className="py-1 text-right">Total</th>
              <th className="py-1 text-right">Paid</th>
            </tr>
          </thead>
          <tbody>
            {recon.orders.map((o) => (
              <tr key={o.orderId} className="border-t border-border/50">
                <td className="py-1">{o.orderNo ?? o.orderId.slice(0, 8)}</td>
                <td className="py-1">{o.status}</td>
                <td className="py-1 text-right">
                  <MoneyDisplay paisa={o.totalPaisa} className="text-xs" />
                </td>
                <td className="py-1 text-right">
                  <MoneyDisplay paisa={o.paidPaisa} className="text-xs" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <TillReviewHistory tillId={tillId} />
    </div>
  );
}

function TillReviewHistory({ tillId }: { tillId: string }) {
  const { data: actions, isLoading, isError, error, refetch } = useTillReviewActions(tillId);

  if (isLoading) return <p className="text-xs text-muted-foreground">Loading review history…</p>;
  // An append-only audit trail that renders "No review actions yet" on a read failure is telling
  // the reader nobody has approved or flagged this till. That is the one claim this table exists
  // to make, and it must never be made from a failed request.
  if (isError) {
    return (
      <QueryErrorNotice
        what="the review history"
        error={error}
        onRetry={() => void refetch()}
        className="text-xs"
      />
    );
  }
  if (!actions || actions.length === 0) {
    return <p className="text-xs text-muted-foreground">No review actions yet.</p>;
  }

  return (
    <div className="space-y-1">
      <p className="text-xs font-medium">Review history</p>
      <table className="w-full text-xs" data-testid="till-review-history">
        <thead className="text-muted-foreground">
          <tr>
            <th className="py-1 text-left">When</th>
            <th className="py-1 text-left">Reviewer</th>
            <th className="py-1 text-left">Action</th>
            <th className="py-1 text-left">Note</th>
          </tr>
        </thead>
        <tbody>
          {actions.map((a) => (
            <tr key={a.id} className="border-t border-border/50">
              <td className="py-1">{fmtTime(a.actedAt)}</td>
              <td className="py-1 font-mono text-muted-foreground">{a.reviewerId.slice(0, 8)}</td>
              <td className="py-1">{a.action}</td>
              <td className="py-1">{a.note ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
