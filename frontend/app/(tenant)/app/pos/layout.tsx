"use client";

import { useEffect } from "react";
import { registerSW } from "@/lib/offline/sw-register";
import { replay, emitProgress } from "@/lib/offline/sync-engine";
import { OfflineIndicator } from "@/components/pos/offline-indicator";
import { SyncStatusBadge } from "@/components/pos/sync-status-badge";
import { ZoneProvider } from "@/components/providers/zone-provider";

export default function PosLayout({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    // Register service worker so the POS shell is cached for offline use.
    void registerSW();

    // Drain any ops that were queued in a previous session before reconnect.
    void replay().then(() => void emitProgress());

    // When the browser comes back online, replay the outbox immediately.
    const handleReconnect = () => {
      void replay().then(() => void emitProgress());
    };

    window.addEventListener("online", handleReconnect);
    return () => {
      window.removeEventListener("online", handleReconnect);
    };
  }, []);

  return (
    /*
     * ZONE: operational (D-34-02). A cashier must complete an order in under ten
     * seconds during a rush. `backdrop-filter` forces a repaint of everything beneath
     * it, and on the cheap Android tablet most restaurants actually use that is
     * measurable jank on the one screen where jank costs money. The offline indicator
     * and sync badge are inside the zone deliberately: they render OVER the terminal,
     * so they are bound by the same rule the terminal is.
     */
    <ZoneProvider zone="operational">
      <OfflineIndicator />
      <SyncStatusBadge />
      {children}
    </ZoneProvider>
  );
}
