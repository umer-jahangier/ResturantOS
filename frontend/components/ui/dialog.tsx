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
  onOpenAutoFocus,
  onCloseAutoFocus,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  showCloseButton?: boolean;
}) {
  const zone = useZone();

  /**
   * WHERE FOCUS GOES WHEN THIS CLOSES — measured, because it was going nowhere.
   *
   * <h3>What was observed</h3>
   *
   * Live on the deployment, 2026-08-22: focus the ⌘K trigger, open the palette, press Escape —
   * `document.activeElement` is `<body>`. Sampled every 25ms across the close, the only focus
   * event fired at all was `focusout` from the palette input. Nothing received focus afterwards,
   * so the next Tab restarts the document from the top. The same probe on
   * `/app/inventory/stock`'s "Opening balance" dialog gave the identical result, which is what
   * turned this from a command-palette curiosity into a finding about every dialog in the
   * product: it is WCAG 2.4.3, and the affected user is the one who cannot use a mouse.
   *
   * <h3>Why Radix does not handle it here</h3>
   *
   * `DialogContentModal` composes its own `onCloseAutoFocus` that calls `event.preventDefault()`
   * — switching OFF `FocusScope`'s restore-to-previously-focused — and then focuses
   * `context.triggerRef.current` instead. That ref is populated by `<DialogTrigger>`. Almost
   * every dialog in this codebase is CONTROLLED: an ordinary `<Button onClick={() => setOpen(true)}>`
   * beside an `<XDialog open={open} …/>`, with no `DialogTrigger` anywhere. So the ref is null,
   * Radix focuses nothing, and it has already disabled the fallback that would have worked.
   * Nothing is misconfigured at the call sites; the default simply does not cover the shape this
   * product uses, so the default is supplied here, once, rather than at fifty of them.
   *
   * <h3>The mechanism</h3>
   *
   * `onOpenAutoFocus` fires from `FocusScope`'s mount effect BEFORE it moves focus into the
   * dialog, so `document.activeElement` at that moment is still whatever opened it — the
   * `DialogTrigger` when there is one, the plain button when there is not. Restoring to it makes
   * the two cases behave identically, so this is a default rather than a divergence.
   *
   * <p>`preventDefault()` is ours to call: Radix's `composeEventHandlers` runs the caller's
   * handler first and skips its own when the default has been prevented. A call site that wants
   * to place focus somewhere else still can — it prevents the default itself, and the guard
   * below stands down.
   */
  const openerRef = React.useRef<HTMLElement | null>(null);

  return (
    <DialogPortal>
      <DialogOverlay />
      <ZoneProvider zone={zone}>
        <DialogPrimitive.Content
          data-slot="dialog-content"
          onOpenAutoFocus={(event) => {
            const active = document.activeElement;
            openerRef.current =
              active instanceof HTMLElement && active !== document.body ? active : null;
            onOpenAutoFocus?.(event);
          }}
          onCloseAutoFocus={(event) => {
            onCloseAutoFocus?.(event);
            if (event.defaultPrevented) return;
            const opener = openerRef.current;
            // `isConnected` matters: a row-scoped dialog is routinely opened from a button that
            // the mutation it performs then removes from the list. Focusing a detached node is a
            // silent no-op that lands on <body> anyway, so in that case Radix/FocusScope is left
            // to do whatever it would have done rather than being overridden into nothing.
            if (!opener || !opener.isConnected) return;
            event.preventDefault();
            opener.focus({ preventScroll: true });
          }}
          // UI-SPEC §11 / brief §40. Measured `null` on all three dialogs the audit probed,
          // including the command palette. Radix sets `role="dialog"` and manages focus, but the
          // audit read `aria-modal` off the DOM and found nothing — so it is set explicitly
          // rather than assumed, and the e2e gate reads it back from the browser for the same
          // reason.
          aria-modal="true"
          // Read by DialogTitle, which reserves room for the close button only when there IS one.
          // See the note there.
          data-has-close={showCloseButton ? "true" : "false"}
          // 38-14 task 3, stamped so the responsive gate can read the surface back off the DOM
          // rather than infer it from a class list `cn()`/tailwind-merge may have merged away.
          data-surface="dialog"
          className={cn(
            // ── Below `md`: a bottom sheet. ──────────────────────────────────────────────────
            //
            // Brief §29/§57, UI-SPEC §9.2. A 384px centred card on a 390px phone is a desktop
            // modal that has been SHRUNK: 16px of dead margin a side, the content squeezed into
            // what is left, and the confirm button landing wherever the box happens to end
            // rather than under the thumb. Full width, anchored to the bottom edge, its own
            // scroll — that is the adaptation.
            //
            // `92dvh`, not `92vh`: on iOS Safari `vh` resolves to the LARGEST viewport height,
            // so a sheet sized in `vh` runs under the URL bar — and the part that goes under it
            // is the footer, i.e. the confirm button.
            //
            // No transform below `md`. The translate that centres the modal is scoped to `md:`
            // and up. A dialog is portalled to `document.body` and is therefore never an
            // ancestor of `.receipt-root`, so this is not a print-path fix; it is the same rule
            // stated positively — no compositing property at a width that does not need one.
            "fixed inset-x-0 bottom-0 z-50 grid max-h-[92dvh] w-full gap-4 overflow-y-auto rounded-t-xl bg-popover p-4 text-sm text-popover-foreground ring-1 ring-foreground/10 outline-none duration-100",
            // ── `md` and above: the centred modal, unchanged in appearance. ──────────────────
            //
            // `md:max-w-sm` is the default that 37 call sites override. Every one of those read
            // `sm:max-w-*` until 38-14 — the width of a dialog was decided at 640px, which the
            // audit does not measure, so between 640 and 767 the product rendered a THIRD
            // layout that was neither the phone one nor the desktop one and that nobody had
            // ever looked at.
            "md:inset-x-auto md:top-1/2 md:bottom-auto md:left-1/2 md:max-h-[calc(100dvh-4rem)] md:w-full md:max-w-sm md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-b-xl",
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
        // `md:`, not `sm:` (38-14): the row/column flip is a LAYOUT MODE change and those happen
        // only at widths the audit measures. Below `md` the actions stack full-width in a bottom
        // sheet, which is where a thumb can reach them; at `md` they become the familiar
        // right-aligned row. `rounded-b-xl` matches the surface, which is square-bottomed as a
        // sheet and rounded as a modal — see `DialogContent`.
        "-mx-4 -mb-4 flex flex-col-reverse gap-2 border-t bg-muted/50 p-4 md:flex-row md:justify-end md:rounded-b-xl",
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
