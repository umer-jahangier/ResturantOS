import { ChefHat, LineChart, Package } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * The brand furniture of the signed-out product: the monogram lockup, and the desktop panel
 * that sits beside the sign-in card.
 *
 * <h3>Why this exists at all</h3>
 *
 * The owner's review of the login screen was "the most worst page", and the diagnosis is not a
 * missing feature — it is that the route rendered a bare card on a flat ground with no brand on
 * it anywhere. Every OTHER surface in the product now carries the demo's devices (the sidebar's
 * monogram tile, the uppercase group labels, the gold rails), so the FIRST screen anyone sees was
 * the only one still shaped like a scaffold.
 *
 * <h3>What is claimed here, and why each claim is safe</h3>
 *
 * D-38-16 governs this file as much as it governs a KPI tile: nothing on a marketing surface may
 * assert something the product cannot back. So there are no counts, no uptime, no testimonials and
 * no logos — only three statements about which modules EXIST, each of which is a route in this
 * repository (`app/(tenant)/app/{pos,tables,kitchen}`, `{inventory,menu,purchasing}`,
 * `{finance,hr,roles,reports}`). A figure would have had to come from somewhere, and there is
 * nowhere to get one before a session exists.
 */

/** The three module families, named after the routes that implement them. */
const CAPABILITIES = [
  {
    icon: ChefHat,
    title: "Front of house",
    detail: "POS terminals, the floor plan and the kitchen display, in step with each other.",
  },
  {
    icon: Package,
    title: "Back of house",
    detail: "Stock counts, recipes, purchase orders and supplier prices.",
  },
  {
    icon: LineChart,
    title: "The office",
    detail: "Finance, payroll, roles and reporting — over every branch at once.",
  },
] as const;

/**
 * The monogram tile, the wordmark and the descriptor — the same lockup the signed-in shell wears
 * (`components/shared/sidebar.tsx` `BrandMark`), at the size an entrance screen wants.
 *
 * <p>The glyph is a hard-coded `R` here and a tenant initial there, deliberately: at sign-in the
 * product does not yet know whose restaurant this is (an email-first login is resolved by the
 * SERVER, after the password), so the mark can only speak for the platform. Deriving it from the
 * `?tenant=` hint would put an unverified string from the address bar into the brand.
 */
export function AuthLockup({ className, size = "md" }: { className?: string; size?: "md" | "lg" }) {
  const large = size === "lg";

  return (
    <div className={cn("flex items-center gap-3", className)}>
      <span
        aria-hidden="true"
        className={cn(
          "flex shrink-0 items-center justify-center rounded-lg",
          "bg-linear-to-br from-primary-400 to-primary-600",
          "font-heading font-extrabold text-primary-solid-foreground",
          "shadow-[0_2px_12px_color-mix(in_oklab,var(--primary-400)_30%,transparent)]",
          large ? "size-11 text-h1" : "size-9 text-h2",
        )}
      >
        R
      </span>
      <span className="min-w-0">
        <span
          className={cn(
            "block truncate font-bold tracking-brandmark text-foreground uppercase",
            large ? "text-body" : "text-small",
          )}
        >
          RestaurantOS
        </span>
        <span className="block truncate text-label text-foreground-tertiary">Restaurant ERP</span>
      </span>
    </div>
  );
}

/**
 * The desktop half of the entrance. Hidden below `lg`, where the card is the whole screen and a
 * column of prose beneath it would be something to scroll past rather than something to read.
 *
 * <h3>Why the gold wash is an inline gradient and not a utility</h3>
 *
 * It is two radial stops in token space (`--primary-500`, `--secondary-500` through
 * `color-mix`), which no Tailwind utility spells, and it must NOT become a blur or a filter:
 * `zone-containment.test.ts` refuses the whole compositing family anywhere under `app/` or
 * `components/`, because `receipt-print.css` pins `.receipt-root` with `position: fixed` and any
 * such property on an ancestor prints the app chrome onto a customer's bill. A painted gradient
 * creates no containing block, so it is the version of this effect that is allowed to exist.
 *
 * <h3>Why the wash stops at this panel's edge</h3>
 *
 * The sign-in card is a `GlassPanel`, and D-34-01 only lets a glass surface ship where its
 * composite has been MEASURED over a declared substrate — `--surface-2`, at 17.73:1. A gradient
 * running under the card would make that substrate unbounded and the measurement meaningless.
 * So the ornament lives on this side of the grid and the card's side of the page stays flat.
 */
export function AuthBrandPanel({ className }: { className?: string }) {
  return (
    <aside
      className={cn(
        "relative hidden flex-col justify-between overflow-hidden border-r border-border bg-background p-10 xl:p-14 lg:flex",
        className,
      )}
    >
      <div
        aria-hidden="true"
        // Half strength in light. The same two stops that read as a warm glow over a near-black
        // ground read as beige-and-mint wash over white — the exact "cheap" quality this screen
        // was rejected for. One opacity utility rather than two gradient definitions, so there is
        // only one place the stops are written down.
        className="pointer-events-none absolute inset-0 opacity-50 dark:opacity-100"
        style={{
          backgroundImage:
            "radial-gradient(120% 95% at 8% 0%, color-mix(in oklab, var(--primary-500) 20%, transparent) 0%, transparent 58%)," +
            "radial-gradient(95% 75% at 100% 100%, color-mix(in oklab, var(--secondary-500) 14%, transparent) 0%, transparent 62%)",
        }}
      />

      <div className="relative">
        <AuthLockup size="lg" />
      </div>

      <div className="relative grid max-w-lg gap-5">
        <p className="text-label font-semibold tracking-eyebrow text-primary uppercase">
          Restaurant operations, end to end
        </p>
        <h2 className="font-heading text-display leading-tight font-semibold text-balance text-foreground">
          One system, from the pass to the P&amp;L.
        </h2>
        <p className="text-body text-foreground-secondary">
          Sign in once and the whole operation is on the same numbers — the terminal on the floor,
          the screen in the kitchen, the stock room and the ledger.
        </p>
      </div>

      <ul className="relative grid max-w-lg gap-0 border-t border-border">
        {CAPABILITIES.map(({ icon: Icon, title, detail }) => (
          <li key={title} className="flex items-start gap-3.5 border-b border-border py-4">
            <span
              aria-hidden="true"
              className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10"
            >
              <Icon className="size-4.5 text-primary" />
            </span>
            <span className="min-w-0">
              <span className="block text-small font-semibold text-foreground">{title}</span>
              <span className="block text-small text-foreground-tertiary">{detail}</span>
            </span>
          </li>
        ))}
      </ul>
    </aside>
  );
}
