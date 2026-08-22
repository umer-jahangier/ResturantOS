"use client";

import * as React from "react";
import { Eye, EyeOff } from "lucide-react";

import { MenuItemImage } from "@/components/menu/MenuItemImage";
import { Button } from "@/components/ui/button";
import { MoneyDisplay } from "@/components/ui/money-display";
import { StatusBadge } from "@/components/ui/status-badge";
import { cn } from "@/lib/utils";

/**
 * One dish, as a product card (plan 38-07 task 7).
 *
 * <h3>Why a card and not a row</h3>
 *
 * A menu is the one back-office list where the picture is part of the record. The admin list
 * rendered a 36px thumbnail at the head of a text row, which is small enough that a manager
 * checking "does every main have a photo?" had to read the list rather than look at it.
 *
 * <h3>No placeholder food photography — stated, because it is a temptation</h3>
 *
 * An item with no picture gets {@link MenuItemImage}'s calm glyph on `bg-decorative`, never a
 * stock photograph of a generic dish. A borrowed photo on a real menu item is a claim about what
 * the customer will be served, and the till renders the same field.
 *
 * <h3>Availability is the card's primary control</h3>
 *
 * Three channels, per UI-SPEC §4.2: the WORD ("Available" / "Unavailable"), the ICON (an open or
 * struck-through eye) and the hue. `aria-pressed` carries the state to assistive tech, so the
 * control announces what it currently IS rather than only what pressing it would do.
 *
 * <p>The card is presentational: it renders whatever `available` it is handed, which is how the
 * page can hand it an OPTIMISTIC value the instant the button is pressed and hand back the real
 * one — or the reverted one — when the server answers.
 */
export interface MenuItemCardProps {
  name: string;
  /** Server-derived image path, or null. Never a URL this component builds. */
  imageUrl?: string | null;
  basePricePaisa: number;
  categoryName?: string | null;
  /** What the card should show RIGHT NOW — optimistic while a toggle is in flight. */
  available: boolean;
  /** A toggle is in flight; the control is disabled but the optimistic state stays on screen. */
  isPending?: boolean;
  onToggleAvailability?: () => void;
  /** Composed by the caller, because the menu of actions is permission-gated. */
  actions?: React.ReactNode;
  className?: string;
}

export function MenuItemCard({
  name,
  imageUrl,
  basePricePaisa,
  categoryName,
  available,
  isPending = false,
  onToggleAvailability,
  actions,
  className,
}: MenuItemCardProps) {
  return (
    <article
      data-slot="menu-item-card"
      aria-label={name}
      className={cn(
        "flex flex-col overflow-hidden rounded-xl border border-border bg-card text-card-foreground",
        !available && "opacity-75",
        className,
      )}
    >
      <MenuItemImage
        imageUrl={imageUrl}
        name={name}
        variant="cover"
        className="aspect-[4/3] w-full"
      />

      <div className="flex flex-1 flex-col gap-(--space-sm) p-(--space-md)">
        <div className="flex items-start justify-between gap-(--space-sm)">
          <div className="min-w-0">
            <h3 className="truncate font-medium">{name}</h3>
            {categoryName ? (
              <p className="truncate text-small text-foreground-tertiary">{categoryName}</p>
            ) : null}
          </div>
          {actions}
        </div>

        <div className="mt-auto flex flex-wrap items-center justify-between gap-(--space-sm)">
          <MoneyDisplay paisa={basePricePaisa} />
          {!available ? <StatusBadge status="archived" label="Inactive" /> : null}
        </div>

        {onToggleAvailability ? (
          <Button
            type="button"
            variant={available ? "outline" : "secondary"}
            // 44px target (UI-SPEC §11). The Button primitive tops out at 36px, so the height is
            // set here rather than by a size token — see the plan report; a `touch` size on the
            // primitive would remove this override from every call site at once.
            className="min-h-11 w-full justify-center"
            aria-pressed={available}
            disabled={isPending}
            onClick={onToggleAvailability}
            data-testid="menu-item-availability"
          >
            {available ? (
              <Eye className="text-success" aria-hidden="true" />
            ) : (
              <EyeOff className="text-foreground-tertiary" aria-hidden="true" />
            )}
            {available ? "Available" : "Unavailable"}
          </Button>
        ) : null}
      </div>
    </article>
  );
}
