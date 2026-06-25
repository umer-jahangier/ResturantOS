import type { ReactNode } from "react";

// Protected tenant app area. Real pages live under /app/* so the route group
// has distinct, non-colliding URLs. proxy.ts gates this prefix.
export default function TenantLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen">
      <aside className="w-64 border-r p-4" data-slot="sidebar">
        {/* Sidebar + BranchSwitcher mount here in plan 04-02. */}
        <span className="font-semibold">RestaurantOS</span>
      </aside>
      <main className="flex-1 p-6">{children}</main>
    </div>
  );
}
