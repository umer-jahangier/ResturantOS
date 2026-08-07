"use client";

import { useState } from "react";
import { toast } from "sonner";

import { useBankAccounts, useCreateApPayment } from "@/lib/hooks/purchasing/use-purchasing";
import type { VendorInvoice } from "@/lib/adapters/purchasing.adapter";
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
import { MoneyDisplay } from "@/components/ui/money-display";

const today = () => new Date().toISOString().slice(0, 10);

/**
 * First frontend consumer of `POST /api/v1/purchasing/payments` -- the endpoint that posts AP ->
 * Bank in finance and publishes `AP_PAYMENT_PROCESSED` (ROADMAP SC#3).
 *
 * `CreateApPaymentRequest.amountPaisa` IS editable server-side (the backend accepts any positive
 * value and falls back to the invoice total when omitted), but `ApPaymentService.create` always
 * sets the invoice to PAID regardless of the amount actually paid -- there is no partial-payment
 * tracking (no running "amount outstanding" on the invoice). The amount field below is therefore
 * editable, but a partial entry does NOT leave the invoice partially open; flagged in the SUMMARY
 * rather than silently pretending partial payment is fully supported.
 */
export function ApPaymentDialog({ invoice }: { invoice: VendorInvoice }) {
  const [open, setOpen] = useState(false);
  const defaultAmount = ((invoice.totalPaisa + invoice.inputTaxPaisa) / 100).toFixed(2);
  const [amountRupees, setAmountRupees] = useState(defaultAmount);
  const [paymentDate, setPaymentDate] = useState(today());
  const [bankAccountCode, setBankAccountCode] = useState("1110");
  const createPayment = useCreateApPayment();

  // Through purchasing's own scoped proxy, not finance's chart of accounts directly: MANAGER may
  // pay a vendor invoice but does not hold finance.coa.view, so reading finance here would 403 for
  // exactly the role that uses this dialog. The proxy already narrows to active leaf cash/bank
  // accounts, so nothing is filtered again on this side.
  const { data: cashAccounts = [] } = useBankAccounts();

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (next) {
      setAmountRupees(defaultAmount);
      setPaymentDate(today());
      setBankAccountCode("1110");
    }
  }

  const amountPaisa = Math.round(Number(amountRupees) * 100);
  const invalid = !Number.isFinite(amountPaisa) || amountPaisa <= 0 || !paymentDate;

  function handleSubmit() {
    createPayment.mutate(
      {
        invoiceId: invoice.id,
        paymentDate,
        amountPaisa,
        bankAccountCode: bankAccountCode.trim() || undefined,
      },
      {
        onSuccess: () => {
          toast.success(`Invoice ${invoice.invoiceNo} paid`);
          setOpen(false);
        },
        onError: (error) => {
          toast.error(error.message || "Could not record the payment. Please try again.");
        },
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button type="button" size="sm">
          Pay
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Pay invoice {invoice.invoiceNo}</DialogTitle>
          <DialogDescription>
            Posts an AP → Bank journal entry and marks the invoice paid.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Invoice total</span>
            <MoneyDisplay paisa={invoice.totalPaisa + invoice.inputTaxPaisa} />
          </div>
          <label className="grid gap-1 text-sm">
            <span className="text-xs font-medium text-muted-foreground">Amount (PKR)</span>
            <Input
              inputMode="decimal"
              value={amountRupees}
              onChange={(e) => setAmountRupees(e.target.value)}
            />
          </label>
          <label className="grid gap-1 text-sm">
            <span className="text-xs font-medium text-muted-foreground">Payment date</span>
            <Input
              type="date"
              value={paymentDate}
              onChange={(e) => setPaymentDate(e.target.value)}
            />
          </label>
          <label className="grid gap-1 text-sm">
            <span className="text-xs font-medium text-muted-foreground">Pay from</span>
            {/* Typed by hand until now, defaulting to a hard-coded "1110" — a GL account code
                nobody outside finance knows, on the one screen that moves real money out. The
                chart of accounts was already fetchable (useAccounts); this just asks it. */}
            <select
              aria-label="Pay from"
              className="h-9 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm focus-visible:border-ring"
              value={bankAccountCode}
              onChange={(e) => setBankAccountCode(e.target.value)}
            >
              {cashAccounts.length === 0 ? (
                <option value={bankAccountCode}>{bankAccountCode}</option>
              ) : null}
              {cashAccounts.map((a) => (
                <option key={a.code} value={a.code}>
                  {a.code} · {a.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={createPayment.isPending || invalid}
            onClick={handleSubmit}
          >
            {createPayment.isPending ? "Paying…" : "Pay invoice"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
