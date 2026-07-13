"use client";

import { use, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";

import { MockGrnReceivePanel } from "@/components/purchasing/MockGrnReceivePanel";
import { PoStatusBadge } from "@/components/purchasing/PoStatusBadge";
import {
  useApprovePurchaseOrder,
  useClosePurchaseOrder,
  usePurchaseOrder,
  useRejectPurchaseOrder,
  useSendPurchaseOrder,
  useSubmitPurchaseOrder,
  useWithdrawPurchaseOrder,
} from "@/lib/hooks/purchasing/use-purchasing";
import { MoneyDisplay } from "@/components/ui/money-display";
import { Button } from "@/components/ui/button";
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

/** 10-07: human-readable copy for the two approval-gate error codes a 403 can carry here. */
function approveErrorMessage(code: string, fallback: string): string {
  if (code === "APPROVAL_LIMIT_EXCEEDED") return "This amount exceeds your approval limit.";
  if (code === "DUPLICATE_APPROVER") return "You have already approved this purchase order.";
  return fallback;
}

function RejectDialog({ onConfirm, isPending }: { onConfirm: (reason: string) => void; isPending: boolean }) {
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
        <Button type="button" variant="outline">
          Reject
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reject purchase order</DialogTitle>
          <DialogDescription>A reason is required and is recorded on the PO.</DialogDescription>
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

export default function PurchaseOrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data: po, isLoading } = usePurchaseOrder(id);
  const submitPo = useSubmitPurchaseOrder(id);
  const withdrawPo = useWithdrawPurchaseOrder(id);
  const approvePo = useApprovePurchaseOrder(id);
  const rejectPo = useRejectPurchaseOrder(id);
  const sendPo = useSendPurchaseOrder(id);
  const closePo = useClosePurchaseOrder(id);
  const [closeReason, setCloseReason] = useState("");

  if (isLoading || !po) return <p>Loading PO…</p>;

  const canClose = po.status === "FULLY_RECEIVED" || po.status === "PARTIALLY_RECEIVED";
  const isShortClose = po.status === "PARTIALLY_RECEIVED";
  const closeDisabled = closePo.isPending || (isShortClose && closeReason.trim().length === 0);

  function handleApprove() {
    approvePo.mutate(undefined, {
      onSuccess: () => toast.success("Approved"),
      onError: (error) => toast.error(approveErrorMessage(error.code, error.message)),
    });
  }

  return (
    <div className="space-y-4">
      <Link href="/app/purchasing/purchase-orders" className="text-sm text-primary">
        ← Purchase orders
      </Link>
      <div className="flex items-center gap-3">
        <h1 className="text-xl font-semibold">PO {po.id.slice(0, 8)}…</h1>
        <PoStatusBadge status={po.status} />
      </div>
      <p className="text-sm text-muted-foreground">
        Total <MoneyDisplay paisa={po.totalPaisa} className="text-foreground" />
        {po.expectedDeliveryDate ? ` · Expected ${po.expectedDeliveryDate}` : ""}
      </p>
      {po.status === "PENDING_APPROVAL" && (
        <p className="text-sm text-muted-foreground">
          Approvals {po.tiersApproved ?? 0} / {po.requiredTiers ?? 1} tiers
        </p>
      )}
      {po.status === "CLOSED" && po.closedAt && (
        <p className="text-sm text-muted-foreground">
          Closed {new Date(po.closedAt).toLocaleString()}
          {po.closeReason ? ` — ${po.closeReason}` : ""}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        {po.status === "DRAFT" && (
          <Button
            type="button"
            disabled={submitPo.isPending}
            onClick={() =>
              submitPo.mutate(undefined, {
                onSuccess: () => toast.success("Submitted for approval"),
                onError: (error) => toast.error(error.message),
              })
            }
          >
            {submitPo.isPending ? "Submitting…" : "Submit for approval"}
          </Button>
        )}

        {po.status === "PENDING_APPROVAL" && (
          <>
            <Button type="button" disabled={approvePo.isPending} onClick={handleApprove}>
              {approvePo.isPending ? "Approving…" : "Approve"}
            </Button>
            <RejectDialog
              isPending={rejectPo.isPending}
              onConfirm={(reason) =>
                rejectPo.mutate(reason, {
                  onSuccess: () => toast.success("Rejected"),
                  onError: (error) => toast.error(error.message),
                })
              }
            />
            <Button
              type="button"
              variant="outline"
              disabled={withdrawPo.isPending}
              onClick={() =>
                withdrawPo.mutate(undefined, {
                  onSuccess: () => toast.success("Withdrawn to draft"),
                  onError: (error) => toast.error(error.message),
                })
              }
            >
              {withdrawPo.isPending ? "Withdrawing…" : "Withdraw"}
            </Button>
          </>
        )}

        {po.status === "APPROVED" && (
          <Button
            type="button"
            disabled={sendPo.isPending}
            onClick={() =>
              sendPo.mutate(undefined, {
                onSuccess: () => toast.success("Sent to vendor"),
                onError: (error) => toast.error(error.message),
              })
            }
          >
            {sendPo.isPending ? "Sending…" : "Send to vendor"}
          </Button>
        )}
      </div>

      <MockGrnReceivePanel poId={po.id} />
      {canClose && (
        <div className="rounded border p-4">
          <h3 className="font-medium">Close PO</h3>
          {isShortClose && (
            <>
              <p className="text-sm text-muted-foreground">
                This PO was only partially received. Short-closing requires a reason and is subject to
                approval.
              </p>
              <input
                className="mt-2 w-full rounded border px-2 py-1 text-sm"
                placeholder="Reason for short-close"
                value={closeReason}
                onChange={(e) => setCloseReason(e.target.value)}
                aria-label="Short-close reason"
              />
            </>
          )}
          <button
            type="button"
            className="mt-2 rounded bg-primary px-3 py-1 text-sm text-primary-foreground disabled:opacity-50"
            disabled={closeDisabled}
            onClick={() => closePo.mutate(isShortClose ? closeReason.trim() : undefined)}
          >
            Close PO
          </button>
        </div>
      )}
    </div>
  );
}
