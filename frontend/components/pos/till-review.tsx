"use client";

import { useState } from "react";
import { ChevronDown, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { MoneyDisplay } from "@/components/ui/money-display";
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
} from "@/lib/hooks/pos/use-till";
import { useCurrentUser } from "@/lib/hooks/auth/use-current-user";
import type { TillSession, TillReviewStatus } from "@/lib/models/pos.model";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 20;

const REVIEW_BADGE: Record<TillReviewStatus, string> = {
  PENDING_REVIEW: "bg-amber-500/15 text-amber-600",
  APPROVED: "bg-emerald-500/15 text-emerald-600",
  FLAGGED: "bg-red-500/15 text-red-600",
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
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Till Review</h1>
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
        <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
          {till.cashierId.slice(0, 8)}
        </td>
        <td className="px-3 py-2">
          <span
            className={cn(
              "rounded px-1.5 py-0.5 text-xs font-medium",
              till.status === "OPEN"
                ? "bg-emerald-500/15 text-emerald-600"
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
            variance !== null && variance < 0 && "text-red-600",
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
