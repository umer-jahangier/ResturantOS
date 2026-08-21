"use client";

import { QueryErrorNotice } from "@/components/ui/query-boundary";
import { Skeleton } from "@/components/ui/skeleton";
import { useMenuCategoriesAdmin } from "@/lib/hooks/pos/use-menu-admin";

/**
 * Which sections of the menu this person may ring — Program A's missing half.
 *
 * <p>The owner's words: *"if a cashier is assigned with Main Bar, he must be shown Main Bar items
 * to add into bill"*, and *"the waiter will have complete menu, for the cashier on the counter it
 * should have a boundary, or maybe we can assign multiple menu to a user so they can take order
 * from that all categories allowed for that user."* Multi-select, because "multiple menu to a
 * user" is the requirement, not a nicety.
 *
 * <p>Everything below this field already existed and was reachable by nobody: the table, the RLS
 * policy, the two endpoints, the JWT claim, the rego rules, the grid filter and the add-item
 * refusal all shipped without a single screen that could write a row. Every user in every tenant
 * therefore had no assignment, the claim was always absent, and the till showed all 394 items.
 * This is the writer.
 *
 * <h3>SELECTING NOTHING MEANS THE WHOLE MENU, and the field says it in words</h3>
 *
 * This is stated as plain text under the list rather than left to be inferred from an unticked
 * column, because the inference an admin actually makes from an empty multi-select is "this person
 * is allowed nothing" — and on a till that is the difference between an unconfigured cashier and
 * one who cannot work a shift. Absence is the ONLY spelling of unrestricted in this stack:
 * auth-service writes no rows, `PermissionResolver` omits the claim key entirely,
 * `pos.rego`'s unrestricted rule matches on that absence, and `MenuCategoryScope.restrictedTo([])`
 * collapses back to `unrestricted()`. Five layers agree. This copy is the sixth, and it is the only
 * one a human reads.
 *
 * <h3>Why there is no "select all"</h3>
 *
 * Deliberately absent, and `MenuCategoryAssignmentRequest`'s own javadoc asks for its absence.
 * Ticking all 51 of this tenant's categories would put ~1.9 KB of UUIDs in every one of that user's
 * request headers to achieve precisely what ticking NOTHING achieves at zero bytes — and it would
 * additionally mean that a category created next week is one the "unrestricted" cashier cannot
 * sell. The clear button below spells unrestricted the way the system spells it.
 *
 * <h3>Why the picker offers every branch, unlike the station field beside it</h3>
 *
 * A station is a row in `pos_stations` keyed to a branch, so `StationAssignmentField` can only
 * offer the branch the admin is signed in to and says so. A menu category is not: `MenuCategory`
 * extends `TenantAuditableEntity` and carries no branch column, so one tenant catalogue serves
 * every site. The assignment row is still per-branch — a person can run the bar at one site and
 * the whole floor at another — but the list of things to tick is the same everywhere, and there is
 * no cross-branch caveat to write.
 *
 * <h3>Why the catalogue comes from the ADMIN listing</h3>
 *
 * `GET /api/v1/pos/menu/categories` is itself scope-filtered now (`MenuServiceImpl.listCategories`).
 * Sourcing the picker from it would mean an administrator who happened to hold a scope could only
 * ever assign categories inside their own — a boundary quietly narrowing itself one admin at a
 * time. `/categories/admin` is the catalogue question ("what sections does this restaurant have"),
 * is deliberately not filtered, and is gated on `pos.menu.manage`, which OWNER and TENANT_ADMIN —
 * the two roles holding the `rbac.role.manage` this write needs — both hold.
 */

/** `AuthJwtProperties.accessTtlSeconds` — 900. Stated in minutes because that is how it reads. */
const ACCESS_TOKEN_MINUTES = 15;

export function MenuCategoryAssignmentField({
  branchLabel,
  value,
  onChange,
  disabled,
}: {
  /** Only for the copy — the catalogue itself is tenant-wide. See the javadoc. */
  branchLabel: string;
  value: string[];
  onChange: (categoryIds: string[]) => void;
  disabled?: boolean;
}) {
  const categories = useMenuCategoriesAdmin();

  // Inactive categories are not offered: assigning one confines a cashier to a section with no
  // sellable items, which presents as an empty till rather than as a mistake. They are not hidden
  // either — an assignment that already names one is reported below rather than silently dropped,
  // because a selection the form cannot show is a selection the form would clear on save.
  const offered = (categories.data ?? []).filter((c) => c.active);
  const offeredIds = new Set(offered.map((c) => c.id));
  const selectedNames = offered.filter((c) => value.includes(c.id)).map((c) => c.name);
  const unlistedCount = categories.isSuccess ? value.filter((id) => !offeredIds.has(id)).length : 0;

  function toggle(id: string) {
    const next = value.includes(id) ? value.filter((c) => c !== id) : [...value, id];
    // Sorted so the payload is stable regardless of click order — auth-service sorts on its side
    // too, and two representations of one set is how a diff becomes noise.
    onChange([...next].sort());
  }

  return (
    <div data-testid="menu-category-assignment-field" className="space-y-2">
      {categories.isPending ? (
        <Skeleton className="h-16 w-full" />
      ) : categories.isError ? (
        // Never an empty picker. An empty list of checkboxes says "this restaurant has no menu
        // categories", which is a different fact from "we could not ask" — and acting on the first
        // when the second is true is how an admin saves a scope over a catalogue they never saw.
        <QueryErrorNotice
          what="this restaurant's menu categories"
          error={categories.error}
          onRetry={() => void categories.refetch()}
          isRetrying={categories.isFetching}
        />
      ) : offered.length === 0 ? (
        <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-small text-muted-foreground">
          There are no active menu categories yet. Add one on the Menu screen and it will appear
          here; until then everyone rings the whole menu.
        </p>
      ) : (
        <>
          <ul
            data-testid="menu-category-assignment-options"
            className="max-h-44 space-y-1 overflow-y-auto rounded-md border p-2"
          >
            {offered.map((category) => (
              <li key={category.id}>
                <label className="flex cursor-pointer items-center gap-2 rounded-md px-1 py-1 text-body hover:bg-muted/50">
                  <input
                    type="checkbox"
                    className="size-4 rounded-md border-input"
                    checked={value.includes(category.id)}
                    disabled={disabled}
                    onChange={() => toggle(category.id)}
                  />
                  <span className="min-w-0 flex-1 truncate">{category.name}</span>
                </label>
              </li>
            ))}
          </ul>

          {/*
            The consequence, not the count. "0 selected" is a number an admin has to interpret, and
            the interpretation they reach unaided is the wrong one. Plain text, never an alert
            style: unrestricted is the correct and universal state, not a problem to be fixed.
          */}
          <p
            data-testid="menu-category-assignment-summary"
            className="text-small text-muted-foreground"
          >
            {value.length === 0
              ? `No sections selected — they can ring the WHOLE menu at ${branchLabel}. That is the default, and it is what every user has today.`
              : selectedNames.length === 0
                ? // Restricted, but to nothing this picker can name. NOT the same sentence as
                  // "nothing selected": one is the permissive default and the other confines a
                  // cashier to a section with no sellable items. Saying "whole menu" here would
                  // describe the opposite of what the server will do.
                  `They are restricted at ${branchLabel}, but only to sections that are no longer active — so they can ring nothing. Tick a section, or Clear to give them the whole menu.`
                : `They can ring ${formatList(selectedNames)} only at ${branchLabel}. Everything else is refused by the server, not just hidden.`}
          </p>

          {value.length > 0 ? (
            <button
              type="button"
              data-testid="menu-category-assignment-clear"
              disabled={disabled}
              onClick={() => onChange([])}
              className="text-small font-medium text-primary underline-offset-2 hover:underline disabled:opacity-50"
            >
              Clear — give them the whole menu again
            </button>
          ) : null}

          {unlistedCount > 0 ? (
            <p
              data-testid="menu-category-assignment-unlisted"
              className="rounded-md border border-border bg-muted/40 px-3 py-2 text-small text-muted-foreground"
            >
              {unlistedCount === 1
                ? "1 section in this assignment is no longer an active category"
                : `${unlistedCount} sections in this assignment are no longer active categories`}
              , so it has no checkbox above. It is kept as-is when you save; use Clear to remove it.
            </p>
          ) : null}
        </>
      )}

      <p
        data-testid="menu-category-assignment-delay-notice"
        className="text-small text-muted-foreground"
      >
        If they are already signed in, the change reaches them when their session next refreshes —
        within {ACCESS_TOKEN_MINUTES} minutes, or straight away if they sign out and back in.
      </p>
    </div>
  );
}

function formatList(names: string[]): string {
  if (names.length === 1) return names[0]!;
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}
