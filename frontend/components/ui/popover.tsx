"use client";

import * as React from "react";
import { Popover as PopoverPrimitive } from "radix-ui";

import { cn } from "@/lib/utils";
import { useZone, ZoneProvider } from "@/components/providers/zone-provider";
import { overlayEntranceClass } from "@/components/ui/overlay-motion";

function Popover({ ...props }: React.ComponentProps<typeof PopoverPrimitive.Root>) {
  return <PopoverPrimitive.Root data-slot="popover" {...props} />;
}

function PopoverTrigger({ ...props }: React.ComponentProps<typeof PopoverPrimitive.Trigger>) {
  return <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} />;
}

function PopoverAnchor({ ...props }: React.ComponentProps<typeof PopoverPrimitive.Anchor>) {
  return <PopoverPrimitive.Anchor data-slot="popover-anchor" {...props} />;
}

/**
 * The popover surface.
 *
 * <p>Zoned entrance (D-38-04): the stock `zoom-*` pair is replaced by `overlayEntranceClass`,
 * which emits nothing on an operational surface — this is the component behind the POS discount
 * and quantity popovers. The `ZoneProvider` gives the portalled node a `data-zone` ancestor so
 * the expressive-scoped rule can match it at all; see `DialogContent` for why that is not
 * optional.
 */
function PopoverContent({
  className,
  align = "start",
  sideOffset = 4,
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Content>) {
  const zone = useZone();
  return (
    <PopoverPrimitive.Portal>
      <ZoneProvider zone={zone}>
        <PopoverPrimitive.Content
          data-slot="popover-content"
          align={align}
          sideOffset={sideOffset}
          className={cn(
            "z-50 w-72 rounded-lg border bg-popover p-4 text-sm text-popover-foreground shadow-md outline-none",
            overlayEntranceClass(zone),
            className,
          )}
          {...props}
        />
      </ZoneProvider>
    </PopoverPrimitive.Portal>
  );
}

export { Popover, PopoverTrigger, PopoverAnchor, PopoverContent };
