import type { ReactNode } from "react";

// Protected SuperAdmin area. Real pages live under /platform/* so the route
// group has distinct, non-colliding URLs. proxy.ts gates this prefix.
export default function PlatformLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b px-6 py-4">
        <span className="font-semibold">RestaurantOS · Platform Admin</span>
      </header>
      <main className="flex-1 p-6">{children}</main>
    </div>
  );
}
