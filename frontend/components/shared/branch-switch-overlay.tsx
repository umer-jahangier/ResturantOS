"use client";

import { Loader2 } from "lucide-react";

interface BranchSwitchOverlayProps {
  isVisible: boolean;
  branchName?: string;
}

export function BranchSwitchOverlay({ isVisible, branchName }: BranchSwitchOverlayProps) {
  if (!isVisible) return null;

  return (
    /*
     * Opaque, not translucent-plus-blur (D-34-02). This overlay is reachable from every
     * zone — a cashier switching branch from the POS gets it full-screen over the
     * terminal — so it is bound by the poorest zone it can appear over. It is also a
     * blocking spinner: nothing behind it is meant to be read, so translucency was
     * buying legibility of content the user is being told to wait for.
     *
     * `bg-background` with `--foreground`/`--muted-foreground` text is a measured
     * phase-20 §3.8 pairing (17.4:1 and 5.6:1 light, 16.1:1 and 6.1:1 dark).
     */
    <div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-background"
      role="status"
      aria-live="polite"
      aria-label="Switching branch"
    >
      <Loader2 className="size-10 animate-spin text-primary" />
      <p className="mt-4 text-sm font-medium text-muted-foreground">
        {branchName ? `Switching to ${branchName}…` : "Switching branch…"}
      </p>
    </div>
  );
}
