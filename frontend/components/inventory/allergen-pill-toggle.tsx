"use client"

import { cn } from "@/lib/utils"

interface Allergen {
  code: string
  label: string
}

// The 14 EU/UK-standard allergens (matches the ingredient master's Compliance section, UI-SPEC
// Screen 2). No checkbox primitive exists in this codebase — each allergen is a pill button with
// `aria-pressed`, matching 07.3's `order-type-toggle` segmented-control visual language.
export const ALLERGENS: ReadonlyArray<Allergen> = [
  { code: "GLUTEN", label: "Gluten" },
  { code: "CRUSTACEANS", label: "Crustaceans" },
  { code: "EGGS", label: "Eggs" },
  { code: "FISH", label: "Fish" },
  { code: "PEANUTS", label: "Peanuts" },
  { code: "SOYBEANS", label: "Soybeans" },
  { code: "MILK", label: "Milk" },
  { code: "NUTS", label: "Tree nuts" },
  { code: "CELERY", label: "Celery" },
  { code: "MUSTARD", label: "Mustard" },
  { code: "SESAME", label: "Sesame" },
  { code: "SULPHITES", label: "Sulphites" },
  { code: "LUPIN", label: "Lupin" },
  { code: "MOLLUSCS", label: "Molluscs" },
] as const

interface AllergenPillToggleProps {
  value: string[]
  onChange: (next: string[]) => void
  disabled?: boolean
  className?: string
}

export function AllergenPillToggle({ value, onChange, disabled = false, className }: AllergenPillToggleProps) {
  function toggle(code: string) {
    if (disabled) return
    const next = value.includes(code) ? value.filter((c) => c !== code) : [...value, code]
    onChange(next)
  }

  return (
    <div role="group" aria-label="Allergens" className={cn("flex flex-wrap gap-1.5", className)}>
      {ALLERGENS.map((allergen) => {
        const selected = value.includes(allergen.code)
        return (
          <button
            key={allergen.code}
            type="button"
            aria-pressed={selected}
            disabled={disabled}
            onClick={() => toggle(allergen.code)}
            className={cn(
              "rounded-full border px-3 py-1 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50",
              selected
                ? "border-primary bg-primary/10 text-primary"
                : "border-border text-muted-foreground hover:text-foreground"
            )}
          >
            {allergen.label}
          </button>
        )
      })}
    </div>
  )
}
