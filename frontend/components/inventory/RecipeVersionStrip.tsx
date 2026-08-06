"use client";

import { cn } from "@/lib/utils";
import type { Recipe } from "@/lib/adapters/inventory.adapter";

interface RecipeVersionStripProps {
  versions: Recipe[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** Injectable for deterministic tests; defaults to the real current time. */
  now?: Date;
  className?: string;
}

/**
 * Screen 3's version-history chip strip (INV-15). One chip per version, newest first, labelled
 * "v{n}" with a suffix: " · current" when the version is the one effective at `now` (the highest
 * version whose `effectiveFrom <= now` — mirrors the backend's own effective-version resolution,
 * never `Recipe.current`), " · scheduled from {date}" when its `effectiveFrom` is in the future.
 * Selecting a chip shows that version's lines read-only below (owned by the page, not here).
 */
export function RecipeVersionStrip({
  versions,
  selectedId,
  onSelect,
  now = new Date(),
  className,
}: RecipeVersionStripProps) {
  const sorted = [...versions].sort((a, b) => b.version - a.version);
  const nowMs = now.getTime();
  const effectiveId =
    sorted.find((version) => new Date(version.effectiveFrom).getTime() <= nowMs)?.id ?? null;

  return (
    <div
      className={cn("flex flex-wrap gap-2", className)}
      role="group"
      aria-label="Recipe versions"
    >
      {sorted.map((version) => {
        const isSelected = version.id === selectedId;
        const isScheduled = new Date(version.effectiveFrom).getTime() > nowMs;
        const isEffective = version.id === effectiveId;
        const suffix = isEffective
          ? " · current"
          : isScheduled
            ? ` · scheduled from ${new Date(version.effectiveFrom).toLocaleDateString()}`
            : "";

        return (
          <button
            key={version.id}
            type="button"
            aria-pressed={isSelected}
            onClick={() => onSelect(version.id)}
            className={cn(
              "rounded-full border px-3 py-1 text-xs transition-colors",
              isSelected
                ? "border-primary bg-primary/10 text-primary"
                : "border-border bg-muted text-muted-foreground hover:text-foreground",
            )}
          >
            v{version.version}
            {suffix}
          </button>
        );
      })}
    </div>
  );
}
