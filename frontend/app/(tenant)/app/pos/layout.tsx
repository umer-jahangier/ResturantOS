"use client";

import { useEffect } from "react";
import { registerSW } from "@/lib/offline/sw-register";
import { replay, emitProgress } from "@/lib/offline/sync-engine";
import { OfflineIndicator } from "@/components/pos/offline-indicator";
import { SyncStatusBadge } from "@/components/pos/sync-status-badge";

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
    <>
      <OfflineIndicator />
      <SyncStatusBadge />
      {children}
    </>
  );
}
