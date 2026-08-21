"use client";

import { useState } from "react";

import { useCurrentUser } from "@/lib/hooks/auth/use-current-user";
import type { MenuCategory } from "@/lib/models/pos.model";
import { cn } from "@/lib/utils";

/**
 * The admin's own switch — *"Admin should have an option to switch the POS, but the user assigned
 * with will have access to only that specific POS."*
 *
 * <h3>It is a VIEW filter, and it says so where it is used</h3>
 *
 * This narrows what the operator is LOOKING at. It grants nothing, revokes nothing, and writes
 * nothing. The boundary is `pos.rego`'s `pos.order.add_item` reached through
 * `OrderServiceImpl.addItem`, and it holds identically whether this control is set or clear — an
 * owner previewing "Main Bar" can still ring a steak, because an owner may. Anyone who reads this
 * as the enforcement has read it wrong, which is why the copy under it is not decoration.
 *
 * <h3>Why an admin is not simply assigned every category</h3>
 *
 * That was the obvious implementation and it is the wrong one. Absence is the documented,
 * load-bearing spelling of "the whole menu" at five layers — auth-service writes no rows, the JWT
 * omits the claim, `pos.rego`'s unrestricted rule matches on the absence, `MenuCategoryScope`
 * collapses an empty list back to `unrestricted()`, and the adapter names the state. An owner
 * holding all 51 category ids would be a RESTRICTED user who happens to be restricted to
 * everything: ~1.9 KB of UUIDs in every request header, and a category created next week would be
 * one the owner could not sell. Absence stays absence; this is a local, throwaway view state.
 *
 * <h3>Why a confined operator gets no switcher at all</h3>
 *
 * A cashier scoped to Drinks already sees only Drinks — the server filtered their grid. Offering
 * them this control could only ever narrow that further, which is a setting with no purpose, and it
 * would strongly imply they could widen it. They get one sentence naming their scope instead, so
 * "why can't I find the steak" has an answer on the screen where it is asked.
 */

/**
 * The claim key. A LITERAL, and deliberately not imported from anywhere: it is the string
 * auth-service's `PermissionResolver.MENU_CATEGORY_SCOPE_CLAIM` mints and `pos.rego` reads, and a
 * rename on either side must be caught by something failing rather than by every confined cashier
 * quietly getting the whole menu back. `MenuCategoryBoundaryIT` pins the same literal on the
 * pos-service side for the same reason.
 */
const MENU_CATEGORY_CLAIM = "menu_categories";

/**
 * The operator's OWN scope, read from their access token.
 *
 * <p>Degrades OPEN on every malformed shape — absent, null, empty, wrong type, non-string entries —
 * exactly as `MenuCategoryScope` does on the server, and for the same reason: reading a malformed
 * claim as "permitted: nothing" would blank a till mid-service. This is a view hint, and the real
 * boundary fails closed separately.
 */
export function ownMenuCategoryScope(attributes: Record<string, unknown>): string[] | null {
  const raw = attributes[MENU_CATEGORY_CLAIM];
  if (!Array.isArray(raw)) return null;
  const ids = raw.filter((v): v is string => typeof v === "string" && v.length > 0);
  return ids.length > 0 ? ids : null;
}

export function MenuScopeSwitch({
  categories,
  preview,
  onPreviewChange,
}: {
  /** The categories the server already decided this operator may see. */
  categories: MenuCategory[];
  /** null = not previewing; the operator is working their full grid. */
  preview: string[] | null;
  onPreviewChange: (next: string[] | null) => void;
}) {
  const { attributes } = useCurrentUser();
  const [open, setOpen] = useState(false);
  const ownScope = ownMenuCategoryScope(attributes);

  if (ownScope) {
    // Confined. No switcher — see the class comment. The names come from the categories the
    // server already sent, which for a scoped operator IS their scope.
    return (
      <p data-testid="menu-scope-confined-notice" className="px-1 text-small text-muted-foreground">
        You are set up for {categories.map((c) => c.name).join(", ") || "no menu sections"}.
        Anything else is not yours to ring — ask a manager if you need a section added.
      </p>
    );
  }

  if (categories.length === 0) return null;

  const previewing = preview !== null;
  const chosen = categories.filter((c) => preview?.includes(c.id));

  function toggle(id: string) {
    const current = preview ?? [];
    const next = current.includes(id) ? current.filter((c) => c !== id) : [...current, id];
    // Emptying the preview means "stop previewing", not "show nothing". There is no state in this
    // product where an operator is shown an empty menu on purpose.
    onPreviewChange(next.length === 0 ? null : next);
  }

  return (
    <div data-testid="menu-scope-switch" className="space-y-1 px-1">
      {/*
        COLLAPSED by default, and a disclosure rather than a second rail.

        <p>The first cut of this was a row of pills above the category rail. It was wrong twice
        over. On screen it put two visually identical rows of the same category names directly
        above each other doing different things — and the test suite caught it as literal
        ambiguity: `getByText("Mains")` matched two elements. On a till it also spent a third row
        of vertical space on a control almost nobody opens; this file already records a measured
        390px disaster where the category rail wrapped to three rows and pushed the first dish
        below the fold, so the budget for a fourth row is zero.
      */}
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          data-testid="menu-scope-switch-toggle"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className={cn(
            "min-h-8 rounded-full border px-3 py-1 text-small font-medium transition-colors",
            previewing
              ? "border-primary bg-primary/10 text-primary"
              : "border-border text-muted-foreground hover:bg-muted/60",
          )}
        >
          {previewing
            ? `Working: ${chosen.map((c) => c.name).join(", ") || "part of the menu"}`
            : "Working: whole menu"}
        </button>
        {previewing ? (
          <button
            type="button"
            data-testid="menu-scope-switch-all"
            onClick={() => onPreviewChange(null)}
            className="min-h-8 rounded-full px-3 py-1 text-small font-medium text-muted-foreground underline-offset-2 hover:underline"
          >
            Back to the whole menu
          </button>
        ) : null}
      </div>

      {open ? (
        <div
          data-testid="menu-scope-switch-panel"
          className="space-y-1 rounded-md border bg-card p-2"
        >
          <ul className="max-h-40 space-y-0.5 overflow-y-auto">
            {categories.map((cat) => (
              <li key={cat.id}>
                <label className="flex cursor-pointer items-center gap-2 rounded-md px-1 py-1 text-body hover:bg-muted/50">
                  <input
                    type="checkbox"
                    className="size-4 rounded-md border-input"
                    checked={preview?.includes(cat.id) ?? false}
                    onChange={() => toggle(cat.id)}
                  />
                  <span className="min-w-0 flex-1 truncate">{cat.name}</span>
                </label>
              </li>
            ))}
          </ul>

          {/*
            Never left implicit, and shown whether or not a preview is active — an owner reading
            this panel is deciding whether it does what they want, and the answer is "not what you
            probably want". An owner who forgets they are previewing and reports "half my menu has
            vanished" is a support call this prevents; an owner who believes this RESTRICTED
            someone is a security misunderstanding it prevents.
          */}
          <p data-testid="menu-scope-switch-notice" className="text-small text-muted-foreground">
            This changes what YOUR screen shows and nothing else. It changes nothing on the server
            and nothing for anyone else — you can still ring the whole menu. To actually confine
            someone, assign their menu sections on the Users screen.
          </p>
        </div>
      ) : null}
    </div>
  );
}
