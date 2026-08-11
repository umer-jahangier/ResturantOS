import type { ReactNode } from "react";

import { ZoneProvider } from "@/components/providers/zone-provider";

/**
 * Public auth area (login, password reset, TOTP). No session required.
 *
 * ZONE: expressive (D-34-02). Login is a first-impression screen with no operator under time
 * pressure on it, so it carries the full surface and motion vocabulary.
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
 */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <ZoneProvider zone="expressive">
      <div className="flex min-h-screen items-center justify-center bg-surface-2 p-4">
        <div className="w-full max-w-md">{children}</div>
      </div>
    </ZoneProvider>
  );
}
