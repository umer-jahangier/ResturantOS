"use client";

import { cn } from "@/lib/utils";
import { useZone } from "@/components/providers/zone-provider";

interface SkeletonProps {
  className?: string;
}

/**
 * A loading placeholder.
 *
 * <h3>It shimmers on a back-office surface and sits STILL on an operational one</h3>
 *
 * The shimmer is a perpetual animation. On the POS terminal or a KDS board that is a permanent
 * repaint on the two screens this phase exists to keep fast — and a suspense boundary in the
 * shell can push one onto those screens without anybody choosing to (D-34-02, and 34-05's
 * prohibition on a perpetual animation in the operational zone).
 *
 * The still variant is not a downgrade. A flat `--muted` block reads as a placeholder perfectly
 * well; the shimmer only adds the suggestion of progress, which matters on a dashboard a manager
 * is watching and not at all on a terminal a cashier is about to tap.
 *
 * Under a reduced-motion preference the shimmer is removed everywhere — see the
 * `prefers-reduced-motion` block in `globals.css`, which sets `.skeleton { animation: none }`
 * rather than merely shortening it.
 */
export function Skeleton({ className }: SkeletonProps) {
  const zone = useZone();
  const still = zone === "operational";

  return (
    <div
      aria-hidden="true"
      role="presentation"
      data-slot="skeleton"
      data-zone={zone}
      className={cn(still ? "rounded-md bg-muted" : "skeleton rounded-md", className)}
    />
  );
}
