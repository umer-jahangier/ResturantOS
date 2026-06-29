"use client";

import { useState } from "react";
import { FeatureGuard } from "@/components/shared/feature-guard";
import { PermissionGuard } from "@/components/shared/permission-guard";
import { PosTerminal } from "@/components/pos/pos-terminal";
import { TableFloorView } from "@/components/pos/table-floor-view";

type PosView = "terminal" | "floor";

export default function PosPage() {
  const [view, setView] = useState<PosView>("terminal");

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
          {/* View tabs */}
          <div className="flex gap-1 px-4 pt-3 border-b bg-background shrink-0">
            <button
              onClick={() => setView("terminal")}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                view === "terminal"
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              POS Terminal
            </button>
            <button
              onClick={() => setView("floor")}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                view === "floor"
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              Floor View
            </button>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-hidden">
            {view === "terminal" ? <PosTerminal /> : <TableFloorView />}
          </div>
        </div>
      </PermissionGuard>
    </FeatureGuard>
  );
}
