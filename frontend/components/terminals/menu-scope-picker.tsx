"use client";

import { QueryErrorNotice } from "@/components/ui/query-boundary";
import { Skeleton } from "@/components/ui/skeleton";
import { useMenuCategories } from "@/lib/hooks/pos/use-menu";

/**
 * Which categories this terminal offers — the "dedicated POS selecting respective menu" control.
 *
 * <h3>The sentence is the feature</h3>
 *
 * With nothing ticked the terminal offers the WHOLE menu. That is the encoding all the way down:
 * plan 28-04 has a test that queries `information_schema` and fails if anything shaped like a
 * `serves_all` column is ever added, because a flag and the rows it summarises can disagree. The
 * consequence for this screen is that an empty checkbox list is the most confusing thing on it, and
 * a plain sentence stating what empty MEANS is the fix. It stays visible; it is not a tooltip.
 *
 * <h3>This is not an access control, and the copy must not imply it is</h3>
 *
 * The category scope is a menu FILTER. Nothing reads it to refuse an add-item — the DDL, the entity
 * and the controller all say so in 28-04, because a half-enforced guard is worse than a declared
 * filter. So the copy says "offers" and "shows", never "can" or "is allowed to". Someone reading
 * this screen must not come away believing a bar till is prevented from ringing up a biryani.
 */
export function MenuScopePicker({
  value,
  onChange,
  disabled,
}: {
  value: string[];
  onChange: (categoryIds: string[]) => void;
  disabled?: boolean;
}) {
  const categories = useMenuCategories();
  const offered = (categories.data ?? []).filter((c) => c.active);
  const selectedNames = offered.filter((c) => value.includes(c.id)).map((c) => c.name);

  function toggle(id: string) {
    const next = value.includes(id) ? value.filter((c) => c !== id) : [...value, id];
    onChange(next);
  }

  return (
    <div data-testid="menu-scope-picker" className="space-y-2">
      <p data-testid="menu-scope-summary" className="text-xs text-muted-foreground">
        {selectedNames.length === 0
          ? "Tick nothing and this terminal offers the whole menu."
          : `This terminal shows ${formatList(selectedNames)} only.`}
      </p>

      {categories.isPending ? (
        <Skeleton className="h-16 w-full" />
      ) : categories.isError ? (
        <QueryErrorNotice
          what="your menu categories"
          error={categories.error}
          onRetry={() => void categories.refetch()}
          isRetrying={categories.isFetching}
        />
      ) : offered.length === 0 ? (
        <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          This branch has no menu categories yet. Add them on Menu Items; until then every terminal
          offers everything.
        </p>
      ) : (
        <ul className="max-h-40 space-y-1 overflow-y-auto rounded-md border p-2">
          {offered.map((category) => (
            <li key={category.id}>
              <label className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-sm hover:bg-muted/50">
                <input
                  type="checkbox"
                  className="size-4 rounded border-input"
                  checked={value.includes(category.id)}
                  disabled={disabled}
                  onChange={() => toggle(category.id)}
                />
                <span className="min-w-0 flex-1 truncate">{category.name}</span>
              </label>
            </li>
          ))}
        </ul>
      )}

      <p className="text-xs text-muted-foreground">
        This decides what the terminal shows. It is not a permission — it does not stop anyone
        ringing up an item, it decides which ones are on the grid in front of them.
      </p>
    </div>
  );
}

function formatList(names: string[]): string {
  if (names.length === 1) return names[0]!;
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}
