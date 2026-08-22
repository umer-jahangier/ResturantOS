"use client";

import { cn } from "@/lib/utils";

interface Section {
  id: string;
  label: string;
}

interface SectionSwitcherProps {
  sections: Section[];
  activeId: string;
  onChange: (id: string) => void;
  ariaLabel: string;
  className?: string;
}

/**
 * Raw button-group tabs-replacement (no Radix Tabs primitive in this codebase) — the same
 * segmented-control shape 07.3's `order-type-toggle` established. Used by vendor detail's
 * Catalog/Price Changes sections (UI-SPEC Screen 6) and any future screen needing lightweight
 * sections without a full Tabs dependency.
 */
export function SectionSwitcher({
  sections,
  activeId,
  onChange,
  ariaLabel,
  className,
}: SectionSwitcherProps) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={cn("inline-flex items-center gap-1 rounded-lg border bg-muted p-1", className)}
    >
      {sections.map((section) => {
        const active = section.id === activeId;
        return (
          <button
            key={section.id}
            type="button"
            role="tab"
            aria-selected={active}
            aria-controls={`section-${section.id}`}
            onClick={() => onChange(section.id)}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm transition-colors",
              active
                ? "bg-primary-solid text-primary-solid-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {section.label}
          </button>
        );
      })}
    </div>
  );
}
