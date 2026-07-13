"use client";

import { useState } from "react";
import { toast } from "sonner";

import { useExpenses, useApproveExpense, useRejectExpense } from "@/lib/hooks/finance/use-finance";
import { ExpenseFormDialog } from "@/components/finance/ExpenseFormDialog";
import { FinanceEmptyState } from "@/components/finance/FinanceEmptyState";
import { StatusBadge } from "@/components/ui/status-badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { MoneyDisplay } from "@/components/ui/money-display";
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
import type { Expense, ExpenseStatus } from "@/lib/models/finance.model";

const STATUS_FILTER_OPTIONS: { value: "" | ExpenseStatus; label: string }[] = [
  { value: "PENDING_APPROVAL", label: "Pending approval" },
  { value: "APPROVED", label: "Approved" },
  { value: "REJECTED", label: "Rejected" },
  { value: "", label: "All statuses" },
];

const STATUS_TO_BADGE: Record<ExpenseStatus, { status: "pending" | "success" | "error"; label: string }> = {
  PENDING_APPROVAL: { status: "pending", label: "Pending approval" },
  APPROVED: { status: "success", label: "Approved" },
  REJECTED: { status: "error", label: "Rejected" },
};

/** 10-05/10-07: the OPA approval-limit-exceeded code — show its meaning explicitly, not a generic error. */
function approveErrorMessage(code: string, fallback: string): string {
  if (code === "EXPENSE_APPROVAL_LIMIT_EXCEEDED") {
    return "This expense exceeds your approval limit.";
  }
  return fallback;
}

function RejectDialog({
  onConfirm,
  isPending,
}: {
  onConfirm: (reason: string) => void;
  isPending: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setReason("");
      }}
    >
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm">
          Reject
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reject expense</DialogTitle>
          <DialogDescription>A reason is required and is recorded on the expense.</DialogDescription>
        </DialogHeader>
        <Input
          aria-label="Rejection reason"
          placeholder="Reason for rejection"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={isPending || reason.trim().length === 0}
            onClick={() => {
              onConfirm(reason.trim());
              setOpen(false);
            }}
          >
            {isPending ? "Rejecting…" : "Reject"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Own component (not a hook inside .map()) so useApproveExpense/useRejectExpense are called consistently per row. */
function ExpenseRow({ expense }: { expense: Expense }) {
  const approveExpense = useApproveExpense(expense.id);
  const rejectExpense = useRejectExpense(expense.id);
  const badge = STATUS_TO_BADGE[expense.status];

  function handleApprove() {
    approveExpense.mutate(undefined, {
      onSuccess: () => toast.success("Expense approved"),
      onError: (error) =>
        toast.error(approveErrorMessage(error.code, error.message), { duration: 6000 }),
    });
  }

  function handleReject(reason: string) {
    rejectExpense.mutate(reason, {
      onSuccess: () => toast.success("Expense rejected"),
      onError: (error) => toast.error(error.message),
    });
  }

  return (
    <tr className="border-b hover:bg-muted/50">
      <td className="py-2 pr-4">{expense.expenseDate}</td>
      <td className="py-2 pr-4 font-mono tabular-nums">{expense.expenseAccountCode}</td>
      <td className="py-2 pr-4">{expense.description ?? "—"}</td>
      <td className="py-2 pr-4">
        <MoneyDisplay paisa={expense.amountPaisa} />
      </td>
      <td className="py-2 pr-4">
        <StatusBadge status={badge.status} label={badge.label} />
      </td>
      <td className="py-2 pr-4 text-xs text-muted-foreground">{expense.requestedBy.slice(0, 8)}…</td>
      <td className="py-2 pr-4">
        {expense.status === "PENDING_APPROVAL" && (
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              disabled={approveExpense.isPending}
              onClick={handleApprove}
            >
              {approveExpense.isPending ? "Approving…" : "Approve"}
            </Button>
            <RejectDialog isPending={rejectExpense.isPending} onConfirm={handleReject} />
          </div>
        )}
        {expense.status === "REJECTED" && expense.rejectReason && (
          <span className="text-xs text-muted-foreground">{expense.rejectReason}</span>
        )}
      </td>
    </tr>
  );
}

// URL: /app/finance/expenses — an approver's inbox (default filter: PENDING_APPROVAL).
export default function ExpensesPage() {
  const [statusFilter, setStatusFilter] = useState<"" | ExpenseStatus>("PENDING_APPROVAL");
  const { data: expenses, isLoading } = useExpenses(statusFilter ? [statusFilter] : undefined);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Expenses</h1>
          <p className="text-sm text-muted-foreground">
            Create, approve and reject expenses. Approvals respect your OPA approval limit.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <select
            aria-label="Filter by status"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as "" | ExpenseStatus)}
            className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            {STATUS_FILTER_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <ExpenseFormDialog trigger={<Button>New expense</Button>} />
        </div>
      </div>

      {isLoading ? (
        <div className="grid gap-2">
          <Skeleton className="h-10" />
          <Skeleton className="h-10" />
          <Skeleton className="h-10" />
        </div>
      ) : !expenses || expenses.length === 0 ? (
        <FinanceEmptyState
          title="No expenses"
          description='Use "New expense" to submit the first expense for approval.'
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="py-2 pr-4 font-medium">Date</th>
                <th className="py-2 pr-4 font-medium">Account</th>
                <th className="py-2 pr-4 font-medium">Description</th>
                <th className="py-2 pr-4 font-medium">Amount</th>
                <th className="py-2 pr-4 font-medium">Status</th>
                <th className="py-2 pr-4 font-medium">Requested by</th>
                <th className="py-2 pr-4 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {expenses.map((expense) => (
                <ExpenseRow key={expense.id} expense={expense} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
