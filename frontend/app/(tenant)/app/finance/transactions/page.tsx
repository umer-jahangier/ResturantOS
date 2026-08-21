"use client";

import { TransactionRegister } from "@/components/finance/TransactionRegister";

// URL: /app/finance/transactions
export default function TransactionsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Transactions</h1>
        <p className="text-sm text-muted-foreground">
          Every payment, refund and void. Open any row to see the order behind it and the accounting
          entries it produced.
        </p>
      </div>
      <TransactionRegister />
    </div>
  );
}
