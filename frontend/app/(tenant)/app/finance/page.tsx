import { redirect } from "next/navigation";

// 37-12 (D-37-02): Finance opens on the day's TAKINGS, not on the chart of accounts.
//
// It used to land on Accounts. A chart of accounts is a list of buckets — genuinely useful, and
// close to the least useful thing to show a restaurant owner first. The question they open this
// module to ask is "what did we take today, and did the drawer match?", so that is the screen the
// module opens on. Accounts keeps its tab, one click away.
export default function FinancePage() {
  redirect("/app/finance/takings");
}
