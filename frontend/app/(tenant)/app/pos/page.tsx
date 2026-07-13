"use client";

import { useState } from "react";
import { FeatureGuard } from "@/components/shared/feature-guard";
import { PermissionGuard } from "@/components/shared/permission-guard";
import { PosTerminal } from "@/components/pos/pos-terminal";
import { TableFloorView } from "@/components/pos/table-floor-view";
import { TillSessionBar } from "@/components/pos/till-session-bar";
import { OrderManagement } from "@/components/pos/order-management";
import { useActiveTill } from "@/lib/hooks/pos/use-till";

type PosView = "terminal" | "floor" | "orders";

const TABS: { id: PosView; label: string }[] = [
  { id: "terminal", label: "POS Terminal" },
  { id: "floor", label: "Floor View" },
  { id: "orders", label: "Order Management" },
];

export default function PosPage() {
  const [view, setView] = useState<PosView>("terminal");
  // Lifted to page level (UI-SPEC §1/§3): the floor view sets it (tap AVAILABLE table,
  // wired fully in plan 10), the terminal reads it to bind createOrder (wired in plan
  // 08). Remounting PosTerminal on a table change resets its in-progress order context
  // — the exact tableId->createOrder binding itself is plan 08's file (pos-terminal.tsx
  // isn't owned by this plan).
  const [selectedTableId, setSelectedTableId] = useState<string | null>(null);

  const { data: activeTill } = useActiveTill();

  return (
    <FeatureGuard
      feature="FEATURE_POS"
      fallback={
        <div className="flex items-center justify-center h-full text-muted-foreground">
          POS feature is not enabled for this account.
        </div>
      }
    >
      <PermissionGuard
        require="pos.order.update"
        fallback={
          <div className="flex items-center justify-center h-full text-muted-foreground">
            You do not have permission to access the POS terminal.
          </div>
        }
      >
        <div className="flex flex-col h-full">
          {/* Till session — page-level chrome, session-scoped (not per-tab/per-order),
              visible identically across every tab (UI-SPEC §3). */}
          <TillSessionBar activeTill={activeTill} />

          {/* View tabs */}
          <div className="flex gap-1 px-4 pt-3 border-b bg-background shrink-0">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setView(tab.id)}
                className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                  view === tab.id
                    ? "border-primary text-primary"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Content */}
          <div className="flex-1 overflow-hidden">
            {view === "terminal" && (
              <PosTerminal key={selectedTableId ?? "unbound"} tableId={selectedTableId} />
            )}
            {view === "floor" && (
              <TableFloorView
                onTableSelect={(table) => {
                  setSelectedTableId(table.id);
                  // Only an AVAILABLE tap switches to the terminal to start a new order
                  // (UI-SPEC §2). OCCUPIED/NEEDS_BUSSING open the Table Detail drawer —
                  // built in plan 10, which owns table-floor-view.tsx.
                  if (table.status === "AVAILABLE") {
                    setView("terminal");
                  }
                }}
              />
            )}
            {view === "orders" && (
              <OrderManagement
                onFullMenu={(tableId) => {
                  // "Full Menu →" (drawer) / "Go to POS" (empty state) escape hatch —
                  // preload the Terminal tab with the order's table when it has one
                  // (TAKEAWAY/DELIVERY orders have none; the tab still switches, just
                  // unbound — createOrder's own tableId binding is plan 08's scope).
                  setSelectedTableId(tableId);
                  setView("terminal");
                }}
              />
            )}
          </div>
        </div>
      </PermissionGuard>
    </FeatureGuard>
  );
}
