"use client";

import * as React from "react";
import { Tooltip as RadixTooltip } from "radix-ui";
import { cn } from "@/lib/utils";
import { useZone, ZoneProvider } from "@/components/providers/zone-provider";
import { overlayEntranceClass } from "@/components/ui/overlay-motion";

const TooltipProvider = RadixTooltip.Provider;
const Tooltip = RadixTooltip.Root;
const TooltipTrigger = RadixTooltip.Trigger;

/**
 * The tooltip surface.
 *
 * <h3>This one was not theoretical</h3>
 *
 * <p>The other shared overlays wrote their entrance behind a `data-open:` variant, which
 * compiles to `[data-open]` while Radix emits `data-state="open"` — so those animations never
 * ran. This file wrote `animate-in fade-in-0 zoom-in-95` UNCONDITIONALLY, with no variant at
 * all, so it is the one that really was scaling a transform-carrying entrance in front of an
 * operator every time a hint appeared on the POS or the KDS. `animate-in` alone is enough for
 * that: tw-animate-css's `enter` keyframe declares `transform` and `filter` whether or not a
 * `zoom-*` utility sets a scale.
 *
 * <p>It is now `overlayEntranceClass(zone)` — nothing on an operational surface, and on an
 * expressive one the same `vdl-enter-scale` every other entrance in the product uses, which
 * carries the `prefers-reduced-motion` removal that the Tailwind utilities did not (D-34-03
 * requires decorative motion to be ABSENT under that preference, not merely shortened).
 *
 * <p>The exit animation is not re-supplied. It was `zoom-out-95` — a transform, on the same
 * screens, at the moment nobody is looking at it.
 */
const TooltipContent = React.forwardRef<
  React.ComponentRef<typeof RadixTooltip.Content>,
  React.ComponentPropsWithoutRef<typeof RadixTooltip.Content>
>(({ className, sideOffset = 4, ...props }, ref) => {
  const zone = useZone();
  return (
    <RadixTooltip.Portal>
      <ZoneProvider zone={zone}>
        <RadixTooltip.Content
          ref={ref}
          data-slot="tooltip-content"
          sideOffset={sideOffset}
          className={cn(
            "z-50 overflow-hidden rounded-md bg-primary-solid px-3 py-1.5 text-xs text-primary-solid-foreground",
            overlayEntranceClass(zone),
            className,
          )}
          {...props}
        />
      </ZoneProvider>
    </RadixTooltip.Portal>
  );
});
TooltipContent.displayName = "TooltipContent";

export { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger };
