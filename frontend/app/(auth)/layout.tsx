import type { ReactNode } from "react";

import { ZoneProvider } from "@/components/providers/zone-provider";
import { MAIN_CONTENT_ID, SkipLink } from "@/components/shared/skip-link";
import { AuthBrandPanel, AuthLockup } from "@/components/auth/auth-brand-panel";

/**
 * Public auth area (login, password reset, TOTP). No session required.
 *
 * ZONE: expressive (D-34-02). Login is a first-impression screen with no operator under time
 * pressure on it, so it carries the full surface and motion vocabulary.
 *
 * <h3>The composition, and why it is a two-column grid rather than a centred box</h3>
 *
 * This route used to render one `max-w-md` card in the middle of a flat page, which is what the
 * product owner was looking at when they called it "the most worst page". It was not wrong so
 * much as unfinished: no brand, no hierarchy, nothing to look at that says which product this is.
 *
 * From `lg` up the page is split — a brand panel that carries the monogram, the one display-serif
 * line and the three module families, and a column that holds the card. Below `lg` the panel is
 * gone entirely (not stacked, not collapsed to a strip) and the card gets the compact lockup
 * above it, so a phone renders one clean column with the brand still on it.
 *
 * <h3>Why the backdrop is a flat token and not a gradient mesh</h3>
 *
 * This is the most tempting place in the whole product to put a photographic or gradient-mesh
 * background behind a glass card, and it is the ONE place where breaking that rule affects
 * users who have not signed in yet.
 *
 * D-34-01 requires every glass surface to carry a measured contrast figure, and a glass surface
 * has no figure of its own — only its composite over a substrate does. Over an arbitrary image
 * or a gradient the substrate is unbounded, so the composite is not merely hard to measure, it
 * is undefined. `lib/theme/glass-surfaces.ts` therefore enumerates the substrates each weight
 * may sit over, and `glass-contrast.test.ts` measures every one.
 *
 * `--surface-2` is one of those enumerated substrates, so the card above resolves a MEASURED
 * pairing: 17.73:1 composited, 18.01:1 with the compositing filter unavailable. `bg-muted`
 * would have resolved to the same colour today by coincidence — it is not a declared substrate,
 * and naming the token that is measured is the difference between a guarantee and a
 * coincidence.
 *
 * <p>That is why the ornament added here is confined to `AuthBrandPanel`. The card's own column
 * is still `--surface-2`, edge to edge, at every width — the gradient never runs beneath the
 * glass, so the measurement the gate makes is still a measurement of what ships.
 */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <ZoneProvider zone="expressive">
      <div className="min-h-screen bg-surface-2 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,34rem)]">
        <AuthBrandPanel />

        {/*
         * `main`, and it is the only landmark on the route — the route had none at all before,
         * so every word on it lived outside a landmark.
         *
         * The `SkipLink` is here because from `lg` up the brand panel comes FIRST in the document
         * and runs to about eighty words. It contains nothing focusable, so a Tab user loses no
         * stops to it — but a screen-reader user reading with the virtual cursor walks all of it
         * before reaching the email field, every time they open the product. That is the saving,
         * and it is why this is not the `app/not-found.tsx` case the G12a gate exempts by name:
         * there really is content in front of the form, it is just not keyboard-focusable.
         */}
        <SkipLink />
        <main
          id={MAIN_CONTENT_ID}
          tabIndex={-1}
          className="flex min-h-screen flex-col justify-center px-5 py-10 md:px-8"
        >
          <div className="mx-auto flex w-full max-w-md flex-col gap-7">
            <AuthLockup className="lg:hidden" />
            {children}
          </div>
        </main>
      </div>
    </ZoneProvider>
  );
}
