"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";

import { useExpenses, useApproveExpense, useRejectExpense } from "@/lib/hooks/finance/use-finance";
import { ExpenseFormDialog } from "@/components/finance/ExpenseFormDialog";
import { FinanceEmptyState } from "@/components/finance/FinanceEmptyState";
import { DataGrid, type ColumnDef } from "@/components/ui/data-grid/data-grid";
import { FilterBar } from "@/components/ui/filter-bar";
import { PageBody } from "@/components/ui/page-body";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { Skeleton } from "@/components/ui/skeleton";
import { QueryBoundary } from "@/components/ui/query-boundary";
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

const STATUS_FILTER_OPTIONS: { value: ExpenseStatus; label: string }[] = [
  { value: "PENDING_APPROVAL", label: "Pending approval" },
  { value: "APPROVED", label: "Approved" },
  { value: "REJECTED", label: "Rejected" },
];

const STATUS_TO_BADGE: Record<
  ExpenseStatus,
  { status: "pending" | "success" | "error"; label: string }
> = {
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
          <DialogDescription>
            A reason is required and is recorded on the expense.
          </DialogDescription>
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

/**
 * Own component (not a hook inside a cell renderer) so `useApproveExpense`/`useRejectExpense` are
 * called once per row, consistently, and never conditionally.
 */
function ExpenseActions({ expense }: { expense: Expense }) {
  const approveExpense = useApproveExpense(expense.id);
  const rejectExpense = useRejectExpense(expense.id);

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

  if (expense.status === "PENDING_APPROVAL") {
    return (
      <div className="flex gap-2">
        <Button type="button" size="sm" disabled={approveExpense.isPending} onClick={handleApprove}>
          {approveExpense.isPending ? "Approving…" : "Approve"}
        </Button>
        <RejectDialog isPending={rejectExpense.isPending} onConfirm={handleReject} />
      </div>
    );
  }

  if (expense.status === "REJECTED" && expense.rejectReason) {
    return <span className="text-small text-foreground-secondary">{expense.rejectReason}</span>;
  }

  return null;
}

// URL: /app/finance/expenses — an approver's inbox (default filter: PENDING_APPROVAL).
export default function ExpensesPage() {
  const [statusFilter, setStatusFilter] = useState<"" | ExpenseStatus>("PENDING_APPROVAL");
  // GA-001: `isError` was never destructured, so a finance-service failure rendered "No expenses"
  // on an APPROVER'S INBOX — an approver who is told there is nothing pending stops looking.
  const expensesQuery = useExpenses(statusFilter ? [statusFilter] : undefined);
  const expenses = expensesQuery.data ?? [];

  const columns = useMemo<ColumnDef<Expense, unknown>[]>(
    () => [
      {
        id: "expenseDate",
        accessorKey: "expenseDate",
        header: "Date",
        cell: ({ row }) => <span className="tabular-nums">{row.original.expenseDate}</span>,
      },
      {
        id: "account",
        accessorKey: "expenseAccountCode",
        header: "Account",
        cell: ({ row }) => (
          <span className="font-mono tabular-nums">{row.original.expenseAccountCode}</span>
        ),
      },
      {
        id: "description",
        accessorKey: "description",
        header: "Description",
        cell: ({ row }) => row.original.description ?? "—",
      },
      {
        id: "amount",
        accessorKey: "amountPaisa",
        header: "Amount",
        cell: ({ row }) => (
          <span className="block text-right">
            <MoneyDisplay paisa={row.original.amountPaisa} />
          </span>
        ),
      },
      {
        id: "status",
        accessorKey: "status",
        header: "Status",
        cell: ({ row }) => {
          const badge = STATUS_TO_BADGE[row.original.status];
          return <StatusBadge status={badge.status} label={badge.label} />;
        },
      },
      {
        id: "requestedBy",
        header: "Requested by",
        enableSorting: false,
        cell: ({ row }) => (
          <span className="text-foreground-secondary">{row.original.requestedBy.slice(0, 8)}…</span>
        ),
      },
      {
        id: "actions",
        header: "Actions",
        enableSorting: false,
        cell: ({ row }) => <ExpenseActions expense={row.original} />,
      },
    ],
    [],
  );

  return (
    <PageBody className="space-y-(--space-lg)">
      <PageHeader
        title="Expenses"
        description="Create, approve and reject expenses. Approvals respect your OPA approval limit."
        actions={<ExpenseFormDialog trigger={<Button>New expense</Button>} />}
      />

      <FilterBar
        title="Expenses"
        filters={[
          {
            id: "status",
            label: "Status",
            value: statusFilter,
            allLabel: "All statuses",
            options: STATUS_FILTER_OPTIONS,
            onChange: (value) => setStatusFilter(value as "" | ExpenseStatus),
          },
        ]}
      />

      <QueryBoundary
        query={expensesQuery}
        what="expenses"
        isEmpty={expenses.length === 0}
        loading={
          <div className="grid gap-2">
            <Skeleton className="h-10" />
            <Skeleton className="h-10" />
            <Skeleton className="h-10" />
          </div>
        }
        empty={
          <FinanceEmptyState
            title="No expenses"
            description='Use "New expense" to submit the first expense for approval.'
          />
        }
      >
        <DataGrid
          label="Expenses"
          columns={columns}
          data={expenses}
          isFiltered={statusFilter !== ""}
          onClearFilters={() => setStatusFilter("")}
          emptyTitle="No expenses"
          emptyDescription='Use "New expense" to submit the first expense for approval.'
          card={{
            primary: (e) => e.description ?? e.expenseAccountCode,
            secondary: (e) => `${e.expenseDate} · ${e.expenseAccountCode}`,
            trailing: (e) => <MoneyDisplay paisa={e.amountPaisa} />,
          }}
        />
      </QueryBoundary>
    </PageBody>
  );
}
