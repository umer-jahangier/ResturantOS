"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";

import { AccessDenied } from "@/components/shared/access-denied";
import { FeatureGuard } from "@/components/shared/feature-guard";
import { PermissionGuard } from "@/components/shared/permission-guard";
import { SectionTabs } from "@/components/shared/section-tabs";
import { useCurrentUser } from "@/lib/hooks/auth/use-current-user";

interface FinanceLayoutProps {
  children: ReactNode;
}

/** The ledger permission. Everything except Takings needs it. */
const LEDGER = "finance.journal.view";

/**
 * Who may see the evening cash-up — the SAME three the API gates on
 * (`DailyTakingsController`, 37-09). Not a fourth, looser rule invented here.
 *
 * <h3>The defect this closes (found in a browser, 37-12)</h3>
 *
 * This layout used to require `finance.journal.view` for the whole module. A BRANCH MANAGER — the
 * person who actually cashes up — does not hold it, so the screen built for them answered "Access
 * denied", while the very same account received HTTP 200 from the takings API. 37-09 had already
 * reasoned this out and put `pos.till.review` in the server's gate precisely because "a MANAGER
 * cashing up holds it and it is precisely the permission for 'did the drawer match'". The UI was
 * simply narrower than the server, which is the quietest kind of broken: nothing errors, the
 * feature just does not exist for the role it was built for.
 *
 * A cashier holds `pos.till.close` and `pos.till.open` but NOT `pos.till.review` (checked against
 * the live token, not assumed), so this does not put branch revenue in front of the till operator.
 */
const TAKINGS = [LEDGER, "pos.order.view.all", "pos.till.review"];

export interface FinanceTab {
  href: string;
  label: string;
  require: string[];
}

/**
 * THE finance tab array. Exported because `guide-coverage.test.tsx` reads it and asserts every
 * entry has a section in the guide (37-13) — so the next phase that adds a finance tab fails that
 * test, which is exactly the moment to write its explanation. A guide that can silently fall
 * behind the module it documents is the guide D-37-03 says is worse than none.
 */
export const FINANCE_TABS: FinanceTab[] = [
  // 37-12: Takings leads, and the finance root redirects here. It is the evening cash-up — the
  // number an owner looks at first, every single day (D-37-02).
  { href: "/app/finance/takings", label: "Takings", require: TAKINGS },
  // 37-11: the register is the first tab an owner wants — "there was no system to see all
  // the orders transactions in the app".
  { href: "/app/finance/transactions", label: "Transactions", require: [LEDGER] },
  { href: "/app/finance/accounts", label: "Accounts", require: [LEDGER] },
  { href: "/app/finance/journal-entries", label: "Journal Entries", require: [LEDGER] },
  { href: "/app/finance/gl", label: "General Ledger", require: [LEDGER] },
  { href: "/app/finance/periods", label: "Periods", require: [LEDGER] },
  { href: "/app/finance/expenses", label: "Expenses", require: [LEDGER] },
  { href: "/app/finance/ap-aging", label: "AP Aging", require: [LEDGER] },
  // FIN-05 AR half (10-18): AR ships as Finance sub-tabs under the existing
  // FEATURE_FINANCE guard below — do NOT invent FEATURE_AR (10-11's nav drift
  // test reads backend flag definitions off disk and fails the build on a
  // phantom flag string).
  { href: "/app/finance/house-accounts", label: "House Accounts", require: [LEDGER] },
  { href: "/app/finance/ar-aging", label: "AR Aging", require: [LEDGER] },
  // 37-13: the tab the user asked for by name. Gated as widely as Takings — the person most
  // likely to need an explanation of this module is the one who has seen the least of it.
  { href: "/app/finance/guide", label: "Guide", require: TAKINGS },
];

function FinanceTabs() {
  const { permissions } = useCurrentUser();
  // A tab the reader cannot open is not shown. Rendering it and letting the click land on an
  // "Access denied" is the product advertising something it will then refuse.
  const visible = FINANCE_TABS.filter((tab) => tab.require.some((p) => permissions.includes(p)));

  // 38-14: eleven tabs. This was the worst instance of the hand-rolled strip in the product — an
  // unwrapped `flex` whose labels lay out past 1,100px, so at 390px, at 768px AND at 1024px an
  // owner could not see that "Guide" existed. `SectionTabs` wraps and carries the 44px floor.
  return <SectionTabs tabs={visible} label="Finance" testId="finance-tabs" />;
}

export default function FinanceLayout({ children }: FinanceLayoutProps) {
  const pathname = usePathname();
  // `/app/finance` itself is counted here because that route is NOTHING BUT a redirect to takings,
  // and the redirect only runs if the page actually renders. Guarding it as a ledger route meant a
  // manager landed on "Access denied" at a URL whose only job was to send them somewhere they were
  // allowed to be — and the redirect never fired, so the address bar sat on /app/finance forever.
  const widelyReadable =
    pathname === "/app/finance" ||
    pathname === "/app/finance/" ||
    (pathname?.startsWith("/app/finance/takings") ?? false) ||
    // 37-13: the Guide explains the module to someone who has not been given the ledger. Gating
    // the explanation behind the thing it explains is the wrong way round.
    (pathname?.startsWith("/app/finance/guide") ?? false);

  return (
    // The OUTER guard is the widest of the module's routes, so a till-reviewing manager reaches
    // the shell at all …
    <PermissionGuard require={TAKINGS} mode="any" fallback={<AccessDenied />}>
      <FeatureGuard feature="FEATURE_FINANCE" failOpenOnError fallback={<AccessDenied />}>
        <FinanceTabs />
        {/* … and the INNER guard keeps every ledger route exactly as tight as it was. Widening
            the shell must not widen the general ledger: someone who may check a drawer has not
            thereby been given the chart of accounts, and typing the URL must not grant it. */}
        {widelyReadable ? (
          children
        ) : (
          <PermissionGuard require={LEDGER} fallback={<AccessDenied />}>
            {children}
          </PermissionGuard>
        )}
      </FeatureGuard>
    </PermissionGuard>
  );
}
