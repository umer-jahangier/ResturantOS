"use client";

import { TransactionRegister } from "@/components/finance/TransactionRegister";
import { PageBody } from "@/components/ui/page-body";
import { PageHeader } from "@/components/ui/page-header";

// URL: /app/finance/transactions
export default function TransactionsPage() {
  return (
    <PageBody className="space-y-(--space-lg)">
      <PageHeader
        title="Transactions"
        description="Every payment, refund and void. Open any row to see the order behind it and the accounting entries it produced."
      />
      <TransactionRegister />
    </PageBody>
  );
}
