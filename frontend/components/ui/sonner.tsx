"use client";

import { useTheme } from "@teispace/next-themes";
import { Toaster as Sonner, type ToasterProps } from "sonner";
import {
  CircleCheckIcon,
  InfoIcon,
  TriangleAlertIcon,
  OctagonXIcon,
  Loader2Icon,
} from "lucide-react";

import { useZone } from "@/components/providers/zone-provider";

/**
 * The toast surface, with the richness zone stamped on its root (34-05, D-34-02).
 *
 * <h3>Why the zone has to be stamped here rather than inherited</h3>
 *
 * Sonner's `ToasterProps` accepts no arbitrary DOM attributes, so `data-zone` cannot be
 * forwarded to its `<section>`; the wrapper below is what carries it. It uses
 * `display: contents`, so it adds no box, establishes no stacking or block-formatting
 * context, and — this is the part that matters here — creates no containing block. A
 * `transform` or `filter` on this wrapper would capture the `position: fixed` sonner
 * relies on, and the same property would capture phase 26's printed receipt.
 *
 * <h3>Why this resolves `restrained` and that is correct, not a bug</h3>
 *
 * `AppProviders` mounts one `<Toaster/>` at the application root, above every zone
 * declaration, so `useZone()` here returns the default — `restrained`. That is the right
 * answer rather than an accident: a single root-mounted toaster renders over the POS
 * terminal and the KDS board as readily as over a dashboard, and SPEC §1 states the rule
 * that governs it — chrome is bound by the poorest zone it can appear over. The same
 * reasoning keeps `TopBar` restrained while the dashboard it frames is expressive.
 *
 * `state-character.test.tsx` asserts the attribute is present and asserts it is never
 * `expressive`, because "expressive" here would mean glass compositing over a cashier's
 * terminal every time an order saved.
 */
const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme();
  const zone = useZone();

  return (
    <div data-zone={zone} data-slot="toaster-zone-root" className="contents">
      <Sonner
        theme={theme as ToasterProps["theme"]}
        className="toaster group"
        icons={{
          success: <CircleCheckIcon className="size-4" />,
          info: <InfoIcon className="size-4" />,
          warning: <TriangleAlertIcon className="size-4" />,
          error: <OctagonXIcon className="size-4" />,
          loading: <Loader2Icon className="size-4 animate-spin" />,
        }}
        style={
          {
            "--normal-bg": "var(--popover)",
            "--normal-text": "var(--popover-foreground)",
            "--normal-border": "var(--border)",
            "--border-radius": "var(--radius)",
          } as React.CSSProperties
        }
        toastOptions={{
          classNames: {
            toast: "cn-toast",
          },
        }}
        {...props}
      />
    </div>
  );
};

export { Toaster };
