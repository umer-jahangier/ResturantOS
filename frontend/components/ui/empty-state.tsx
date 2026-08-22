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
        className="flex size-20 items-center justify-center rounded-full bg-decorative shadow-depth-1"
        /* bg-decorative, not bg-surface-2 (D-38-19): this disc is decoration and must stay
           colourless, so an error notice remains visibly LOUDER than an empty result. */
      >
        <Icon className="size-9 text-foreground-tertiary" aria-hidden="true" />
      </div>
      {/*
       * Type ROLES, not the raw scale (D-38-02, UI-SPEC §3). This read `text-lg`/`text-sm` — two
       * of the twelve sizes the audit found shipping against a contract of eight roles, and the
       * two recorded against this file in `conformance-baseline.json`.
       *
       * <p>`text-h2` is the heading role and `text-small` the secondary one, which is what these
       * two lines already WERE in intent: a title and a supporting sentence. The empty state is a
       * poor place to be off-contract, because it is the surface a person meets on a screen they
       * have never successfully used — the first typography they judge the product by.
       */}
      <div className="flex flex-col gap-1">
        <p className="text-h2 font-semibold text-foreground">{title}</p>
        {description && <p className="text-small text-muted-foreground">{description}</p>}
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
