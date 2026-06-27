"use client";

import { Loader2 } from "lucide-react";

interface BranchSwitchOverlayProps {
  isVisible: boolean;
  branchName?: string;
}

export function BranchSwitchOverlay({ isVisible, branchName }: BranchSwitchOverlayProps) {
  if (!isVisible) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-background/90 backdrop-blur-sm"
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
