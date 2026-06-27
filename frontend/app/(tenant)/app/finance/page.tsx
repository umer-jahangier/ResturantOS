import { redirect } from "next/navigation";

// Finance root redirects to the Accounts sub-page (the natural entry point).
export default function FinancePage() {
  redirect("/app/finance/accounts");
}
