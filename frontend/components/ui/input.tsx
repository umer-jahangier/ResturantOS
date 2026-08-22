import * as React from "react";

import { cn } from "@/lib/utils";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        // UI-SPEC §3.2 / §5.3. Two changes, both contrast fixes rather than restyles:
        //
        //  1. `border-input` → `border-border-interactive`. The old `--input` was
        //     `oklch(0.922 0 0)`, which measures 1.23:1 on white — every text field in the
        //     product failed WCAG 2.2 SC 1.4.11, which requires 3:1 for a boundary that
        //     identifies a component. `--border-interactive` measures 3.77:1 light /
        //     3.48:1 dark (asserted in __tests__/lib/theme/design-tokens.test.ts).
        //
        //  2. The `bg-input/*` states now name a surface. `--input` used to double as a
        //     translucent fill AND a border colour; now that it points at an opaque
        //     mid-grey, reusing it as a background would wash the field out. Disabled and
        //     dark fills read from the surface ramp, which is what they always meant.
        //
        // `outline-none` and the focus ring are gone: focus is an outline in globals.css
        // (§3.9) so it survives the scroll containers this input sits inside.
        // `touch-floor` — 44px below `lg`, the declared height at and above it. A 32px text
        // field is not merely small on a phone: the tap that misses it lands on whatever is
        // behind, and on a form that is usually another field.
        "touch-floor h-8 w-full min-w-0 rounded-lg border border-border-interactive bg-transparent px-2.5 py-1 text-base transition-colors file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:border-ring disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:bg-surface-2 dark:disabled:bg-surface-3 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
        className,
      )}
      {...props}
    />
  );
}

export { Input };
