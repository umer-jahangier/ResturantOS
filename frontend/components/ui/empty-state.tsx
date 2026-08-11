"use client";

import * as React from "react";
import { Inbox, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: {
    label: string;
    onClick: () => void;
  };
  className?: string;
}

function EmptyState({
  icon: Icon = Inbox,
  title,
  description,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn("flex flex-col items-center justify-center gap-3 py-12 text-center", className)}
    >
      {/*
       * Phase 34: the icon sits in a soft ramp-tinted disc so the empty state reads as designed
       * rather than as an unstyled default. The disc is DECORATION ONLY — the title, the
       * description and the action below are untouched, because an empty state teaches what to
       * do next and 34-05 forbids losing that affordance to an illustration.
       */}
      <div
        aria-hidden="true"
        className="flex size-20 items-center justify-center rounded-full bg-surface-2 shadow-depth-1"
      >
        <Icon className="size-9 text-foreground-tertiary" aria-hidden="true" />
      </div>
      <div className="flex flex-col gap-1">
        <p className="text-lg font-semibold text-foreground">{title}</p>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
      {action && (
        <Button variant="outline" onClick={action.onClick}>
          {action.label}
        </Button>
      )}
    </div>
  );
}

export { EmptyState };
