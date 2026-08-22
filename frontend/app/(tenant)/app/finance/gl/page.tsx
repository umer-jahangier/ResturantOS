import { GeneralLedger } from "@/components/finance/GeneralLedger";
import { PageBody } from "@/components/ui/page-body";
import { PageHeader } from "@/components/ui/page-header";

// URL: /app/finance/gl
export default function GeneralLedgerPage() {
  return (
    <PageBody className="space-y-(--space-lg)">
      <PageHeader
        title="General Ledger"
        description="Account balances by period. Open a code to drill into its transactions."
      />
      <GeneralLedger />
    </PageBody>
  );
}
