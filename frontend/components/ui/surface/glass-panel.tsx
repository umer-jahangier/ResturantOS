"use client";

import * as React from "react";

import { cn } from "@/lib/utils";
import { useZone } from "@/components/providers/zone-provider";

export interface GlassPanelProps extends React.ComponentProps<"div"> {
  /**
   * `panel` is the lighter weight for content surfaces; `overlay` is the heavier weight for
   * things that sit above content. Both are measured in
   * `__tests__/lib/theme/glass-contrast.test.ts` against their declared substrates.
   */
  weight?: "panel" | "overlay";
  /** Depth level. Additive to the surface's own shadow; see globals.css `--depth-*`. */
  depth?: 1 | 2 | 3;
  /** Adds the hover lift. Only translates in the expressive zone; see `.vdl-lift`. */
  interactive?: boolean;
  asChild?: boolean;
}

/**
 * A glass surface — the composable primitive every expressive screen uses instead of authoring
 * surface treatment inline.
 *
 * <h3>It refuses to enrich itself outside the expressive zone, TWICE</h3>
 *
 * The cascade already handles this: the translucent fill and the compositing filter live in a
 * rule scoped to `[data-zone="expressive"]`, so a `GlassPanel` rendered on the POS terminal
 * gets the opaque fallback and nothing else, no matter what this component does.
 *
 * The component checks again anyway, through `useZone()`. Two reasons. A portalled surface has
 * no zone ancestor, so the cascade cannot reach it and only the context can. And a mis-imported
 * primitive should DEGRADE visibly at the component boundary rather than depending on a
 * stylesheet rule several files away being correct — the failure mode this phase keeps finding
 * is a rule that is present and never matches.
 *
 * <p>Nothing here animates a property outside the transform and opacity families. Animating a
 * dimension, a position offset, a shadow spread or a filter radius moves work onto the main
 * thread and defeats the point of using transforms for depth (D-34-06).
 */
export function GlassPanel({
  weight = "panel",
  depth = 2,
  interactive = false,
  className,
  ...props
}: GlassPanelProps) {
  const zone = useZone();
  const expressive = zone === "expressive";

  return (
    <div
      data-slot="glass-panel"
      data-zone={zone}
      data-weight={weight}
      className={cn(
        "rounded-xl",
        weight === "overlay" ? "glass-surface-overlay" : "glass-surface",
        depth === 1 && "shadow-depth-1",
        depth === 2 && "shadow-depth-2",
        depth === 3 && "shadow-depth-3",
        // The lift is offered outside the expressive zone too — it resolves to a shadow-only
        // acknowledgement there, which is what a restrained surface should do.
        interactive && "vdl-lift",
        interactive && !expressive && "transition-shadow",
        className,
      )}
      {...props}
    />
  );
}
