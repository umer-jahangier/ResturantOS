import type { ReactNode } from "react";

import { Sidebar } from "@/components/shared/sidebar";
import { BranchSwitcher } from "@/components/shared/branch-switcher";

// Protected tenant app area. Real pages live under /app/* so the route group
// has distinct, non-colliding URLs. proxy.ts gates this prefix. The Sidebar
// (permission/feature-conditioned) and the BranchSwitcher mount here.
export default function TenantLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen">
      <aside className="w-64 border-r p-4" data-slot="sidebar">
        <span className="mb-4 block font-semibold">RestaurantOS</span>
        <Sidebar />
      </aside>
      <div className="flex flex-1 flex-col">
        <header className="flex items-center justify-end border-b px-6 py-3">
          <BranchSwitcher />
        </header>
        <main className="flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}
