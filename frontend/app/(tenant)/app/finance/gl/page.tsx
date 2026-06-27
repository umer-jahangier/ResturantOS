import { GeneralLedger } from "@/components/finance/GeneralLedger";

// URL: /app/finance/gl
export default function GeneralLedgerPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">General Ledger</h1>
        <p className="text-sm text-muted-foreground">
          Account balances by period. Click a row to drill into transactions.
        </p>
      </div>

      <GeneralLedger />
    </div>
  );
}
