"use client";

import * as React from "react";
import { Dialog as DialogPrimitive } from "radix-ui";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useZone, ZoneProvider } from "@/components/providers/zone-provider";
import { overlayEntranceClass } from "@/components/ui/overlay-motion";
import { XIcon } from "lucide-react";

function Dialog({ ...props }: React.ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />;
}

function DialogTrigger({ ...props }: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />;
}

function DialogPortal({ ...props }: React.ComponentProps<typeof DialogPrimitive.Portal>) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />;
}

function DialogClose({ ...props }: React.ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />;
}

/**
 * The shared dialog overlay.
 *
 * The blur used to live here as a `supports-backdrop-filter:backdrop-blur-xs` utility,
 * which meant every dialog in the product carried it — including the ones a cashier
 * opens on the POS terminal. It is gone from this file entirely. The effect is now
 * supplied by a single zone-scoped rule in globals.css keyed on `data-slot` +
 * `data-zone`, so the CASCADE decides where glass is legal rather than developer
 * discipline at each call site (D-34-02).
 *
 * That only works because of the `data-zone` stamp below, and this is the single most
 * likely thing in this phase to be written, look correct, and do nothing: Radix portals
 * this node to `document.body`, which is outside every zone subtree, so a rule written
 * against DOM ancestry would never match. `useZone()` reads the zone at the TRIGGER's
 * position in the React tree — which the portal preserves — and we copy it onto the
 * portalled node by hand.
 */
function DialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  const zone = useZone();
  return (
    <DialogPrimitive.Overlay
      data-slot="dialog-overlay"
      data-zone={zone}
      className={cn(
        "fixed inset-0 isolate z-50 bg-black/10 duration-100 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0",
        className,
      )}
      {...props}
    />
  );
}

/**
 * The dialog surface.
 *
 * <h3>The entrance is zoned (D-38-04), and the zone travels through the portal (D-38-05)</h3>
 *
 * <p>This carried the stock shadcn `zoom-in-95` / `zoom-out-95` pair — a TRANSFORM-based
 * entrance on a shared component the POS and the KDS both import, which is the indirect route
 * the spec warns about: nobody puts motion on the POS on purpose, they put it on a `Dialog` the
 * POS opens two hundred times a shift. It is now `overlayEntranceClass(zone)`, absent entirely
 * on an operational surface.
 *
 * <p>The `ZoneProvider` inside the portal is the half that is easy to skip and impossible to do
 * without. Radix mounts this node on `document.body`, so the entrance rule
 * (`[data-zone="expressive"] .vdl-enter-scale`) has no zone ancestor to match against and would
 * be a rule that is present in the stylesheet and never fires. Re-publishing the zone here gives
 * the portalled subtree the `data-zone` ancestor the cascade needs — and it does so with
 * `display: contents`, so it adds no box, no stacking context and, critically for the receipt
 * print path, no containing block. `__tests__/components/ui/overlay-zone-motion.test.tsx` runs
 * the globals.css selector against the real DOM rather than trusting the class name.
 */
function DialogContent({
  className,
  children,
  showCloseButton = true,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  showCloseButton?: boolean;
}) {
  const zone = useZone();
  return (
    <DialogPortal>
      <DialogOverlay />
      <ZoneProvider zone={zone}>
        <DialogPrimitive.Content
          data-slot="dialog-content"
          // UI-SPEC §11 / brief §40. Measured `null` on all three dialogs the audit probed,
          // including the command palette. Radix sets `role="dialog"` and manages focus, but the
          // audit read `aria-modal` off the DOM and found nothing — so it is set explicitly
          // rather than assumed, and the e2e gate reads it back from the browser for the same
          // reason.
          aria-modal="true"
          // Read by DialogTitle, which reserves room for the close button only when there IS one.
          // See the note there.
          data-has-close={showCloseButton ? "true" : "false"}
          className={cn(
            "fixed top-1/2 left-1/2 z-50 grid w-full max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 gap-4 rounded-xl bg-popover p-4 text-sm text-popover-foreground ring-1 ring-foreground/10 duration-100 outline-none sm:max-w-sm",
            overlayEntranceClass(zone),
            className,
          )}
          {...props}
        >
          {children}
          {showCloseButton && (
            <DialogPrimitive.Close data-slot="dialog-close" asChild>
              <Button variant="ghost" className="absolute top-2 right-2" size="icon-sm">
                <XIcon />
                <span className="sr-only">Close</span>
              </Button>
            </DialogPrimitive.Close>
          )}
        </DialogPrimitive.Content>
      </ZoneProvider>
    </DialogPortal>
  );
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div data-slot="dialog-header" className={cn("flex flex-col gap-2", className)} {...props} />
  );
}

function DialogFooter({
  className,
  showCloseButton = false,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  showCloseButton?: boolean;
}) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        "-mx-4 -mb-4 flex flex-col-reverse gap-2 rounded-b-xl border-t bg-muted/50 p-4 sm:flex-row sm:justify-end",
        className,
      )}
      {...props}
    >
      {children}
      {showCloseButton && (
        <DialogPrimitive.Close asChild>
          <Button variant="outline">Close</Button>
        </DialogPrimitive.Close>
      )}
    </div>
  );
}

/**
 * The title reserves room for the close button — but only when there is one.
 *
 * <p>The close button is `absolute top-2 right-2` at `icon-sm`, so it floats over whatever the
 * header put there, and the title had no right padding at all. Any title long enough to reach the
 * corner therefore ran UNDERNEATH the ✕. Caught on S2's revoke confirmation, whose title has to
 * name both the role and the branch — "Revoke OWNER at Floating Terrace — Rooftop?" collided with
 * the button and the last character was unreadable
 * (`.planning/audits/floor/S2/p08-admin-refused-in-dialog.png`, first run). Every dialog in the app
 * shares this; short titles simply never reached far enough to show it.
 *
 * <p>Keyed off `data-has-close` on the content rather than applied unconditionally, so a dialog
 * built with `showCloseButton={false}` does not get a gutter reserved for a button it does not
 * render. `in-*` is the same variant `button.tsx` already uses to read a slot off an ancestor.
 */
function DialogTitle({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn(
        "font-heading text-base leading-none font-medium in-data-[has-close=true]:pr-8",
        className,
      )}
      {...props}
    />
  );
}

function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn(
        "text-sm text-muted-foreground *:[a]:underline *:[a]:underline-offset-3 *:[a]:hover:text-foreground",
        className,
      )}
      {...props}
    />
  );
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
};
