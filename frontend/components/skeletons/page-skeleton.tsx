import { Skeleton } from "@/components/ui/skeleton";

/**
 * The shape of a page that has not arrived yet: a heading, a description line, and a body.
 *
 * <h3>Why this replaced a spinner</h3>
 *
 * `app/(tenant)/layout.tsx` rendered a rotating ring, centred in an otherwise blank content area,
 * for the whole of session bootstrap. It is the one loading state EVERY signed-in user sees, on
 * every route, and it did three things wrong at once (UI-SPEC §25):
 *
 * <ul>
 *   <li>It blanked the region entirely, so the shell's first paint told the reader nothing about
 *       what was coming — a spinner is the same picture whether the next screen is a dashboard or
 *       a login failure.</li>
 *   <li>It was a perpetual rotation, and this layout wraps the POS and the KDS as readily as it
 *       wraps a settings form. A spinner in the SHELL is a spinner on the till (D-38-04).</li>
 *   <li>It collapsed to nothing when the content appeared, so the whole page jumped.</li>
 * </ul>
 *
 * The block sizes below are the contract's own page grammar — `PageHeader`'s title and
 * description, then a body region — so the placeholder occupies roughly the box the real page
 * will, and the swap does not move the reading position.
 *
 * <p>Every block is a `Skeleton`, which reads the zone from context: this shimmers behind a
 * back-office route and sits perfectly still behind `/app/pos` and `/app/kds`.
 */
export function PageSkeleton() {
  return (
    <div
      role="status"
      aria-label="Loading session…"
      className="flex flex-col gap-(--space-lg) p-(--space-lg)"
    >
      {/* PageHeader: title, then the one-line description that sits under it. */}
      <div className="flex flex-col gap-(--space-sm)">
        <Skeleton className="h-8 w-56 max-w-full" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>

      {/* The body region. Three bands rather than one block: a single tall rectangle reads as a
          panel that failed to render, and three read as content that has not arrived. */}
      <div className="flex flex-col gap-(--space-md)">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    </div>
  );
}
