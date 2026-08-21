"use client";

import { useState } from "react";
import { MoreHorizontal } from "lucide-react";
import { toast } from "sonner";

import {
  useArchiveIngredient,
  useCategories,
  useIngredients,
  useRestoreIngredient,
} from "@/lib/hooks/inventory/use-inventory";
import { useDebouncedValue } from "@/lib/hooks/use-debounce";
import { countLine, filteredCountLine, statLine } from "@/lib/format/stat-line";
import type { Ingredient } from "@/lib/adapters/inventory.adapter";
import { AllergenPillToggle } from "@/components/inventory/allergen-pill-toggle";
import { IngredientFormDialog } from "@/components/inventory/IngredientFormDialog";
import { PermissionGuard } from "@/components/shared/permission-guard";
import { DataGrid, type ColumnDef } from "@/components/ui/data-grid/data-grid";
import { FilterBar } from "@/components/ui/filter-bar";
import { Select } from "@/components/ui/select";
import { StatusBadge } from "@/components/ui/status-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { QueryBoundary } from "@/components/ui/query-boundary";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { PageBody } from "@/components/ui/page-body";
import { PageHeader } from "@/components/ui/page-header";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const EMPTY_TITLE = "No ingredients yet";
const EMPTY_BODY = "Add an ingredient to start building recipes and vendor catalogs.";

type IngredientFormTarget = { mode: "create" } | { mode: "edit"; ingredient: Ingredient };

type StatusFilter = "ACTIVE" | "ARCHIVED" | "ALL";

/** The status dimension is a closed set, so it is a `FilterBar` filter rather than free text.
 *  `""` is not offered: "all" is a real, named third state here, not the absence of a filter. */
const STATUS_OPTIONS = [
  { value: "ACTIVE", label: "Active" },
  { value: "ARCHIVED", label: "Archived" },
  { value: "ALL", label: "Active and archived" },
] as const;

// URL: /app/inventory/ingredients — INV-01/INV-14's whole UI surface: create/search/filter/edit/
// archive ingredients (UI-SPEC Screen 2). Section tabs are owned by inventory/layout.tsx (08.2-14)
// and are not touched here.
export default function IngredientsPage() {
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, 300);
  const [categoryFilter, setCategoryFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("ACTIVE");
  const [allergenFilter, setAllergenFilter] = useState<string[]>([]);

  const categoriesQuery = useCategories();
  const categories = categoriesQuery.data;
  const ingredientsQuery = useIngredients({
    search: debouncedSearch.trim() || undefined,
    categoryId: categoryFilter || undefined,
    status: statusFilter,
  });
  const ingredients = ingredientsQuery.data;
  const archiveIngredient = useArchiveIngredient();
  const restoreIngredient = useRestoreIngredient();

  const [formTarget, setFormTarget] = useState<IngredientFormTarget | null>(null);
  const [archiving, setArchiving] = useState<Ingredient | null>(null);

  const activeCategories = (categories ?? []).filter((c) => c.archivedAt == null);

  // Server-side search/category/status already narrowed `ingredients` (useIngredients' filters
  // argument); the allergen multi-select has no server-side filter param, so it's applied here —
  // a row matches if it carries ANY of the selected allergen codes (multi-select-as-OR).
  const serverRows = ingredients ?? [];
  const rows = serverRows.filter(
    (i) =>
      allergenFilter.length === 0 || allergenFilter.some((code) => i.allergenCodes.includes(code)),
  );

  function openCreate() {
    setFormTarget({ mode: "create" });
  }

  function openEdit(ingredient: Ingredient) {
    setFormTarget({ mode: "edit", ingredient });
  }

  function handleArchiveRequest(ingredient: Ingredient) {
    setArchiving(ingredient);
  }

  function handleConfirmArchive() {
    if (!archiving) return;
    archiveIngredient.mutate(archiving.id, {
      onSuccess: () => {
        toast.success(`Archived ${archiving.name}`);
        setArchiving(null);
      },
      onError: (error) => {
        // Unlike categories, ingredients have no in-use refusal path — a plain toast is enough,
        // but the dialog still only closes on success.
        toast.error(error.message || "Could not archive this ingredient. Please try again.");
      },
    });
  }

  function handleRestore(ingredient: Ingredient) {
    restoreIngredient.mutate(ingredient.id, {
      onSuccess: () => toast.success(`Restored ${ingredient.name}`),
      onError: (error) => {
        toast.error(error.message || "Could not restore the ingredient. Please try again.");
      },
    });
  }

  const columns: ColumnDef<Ingredient, unknown>[] = [
    {
      accessorKey: "name",
      header: "Name",
      cell: ({ row }) => (
        <div>
          <div>{row.original.name}</div>
          {row.original.shortName ? (
            <div className="text-small text-muted-foreground">{row.original.shortName}</div>
          ) : null}
        </div>
      ),
    },
    {
      accessorKey: "categoryName",
      header: "Category",
      cell: ({ row }) =>
        row.original.categoryName ? (
          <button
            type="button"
            className="text-primary hover:underline"
            onClick={() => setCategoryFilter(row.original.categoryId)}
          >
            {row.original.categoryName}
          </button>
        ) : (
          "—"
        ),
    },
    {
      accessorKey: "baseUomCode",
      header: "Stock unit",
    },
    {
      accessorKey: "parLevel",
      header: "Par level",
      cell: ({ row }) => row.original.parLevel ?? "—",
    },
    {
      accessorKey: "reorderPoint",
      header: "Reorder point",
    },
    {
      accessorKey: "storageLocation",
      header: "Storage location",
      cell: ({ row }) => row.original.storageLocation ?? "—",
    },
    {
      id: "status",
      header: "Status",
      cell: ({ row }) =>
        row.original.active ? (
          <StatusBadge status="active" label="Active" />
        ) : (
          <StatusBadge status="archived" label="Archived" />
        ),
    },
    {
      id: "actions",
      header: "Actions",
      cell: ({ row }) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={`Actions for ${row.original.name}`}
            >
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => openEdit(row.original)}>Edit</DropdownMenuItem>
            {row.original.active ? (
              <DropdownMenuItem
                variant="destructive"
                onSelect={() => handleArchiveRequest(row.original)}
              >
                Archive
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem onSelect={() => handleRestore(row.original)}>
                Restore
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ];

  return (
    <PageBody className="space-y-(--space-lg)">
      <PageHeader
        title="Ingredients"
        description="Create, search, edit and archive the ingredients your recipes and purchase orders draw from."
        meta={statLine(
          // Both counts come from the arrays the grid itself renders: `rows` is what is on
          // screen, `serverRows` is what survived the server-side name/category/status filters.
          // The allergen multi-select narrows only in the browser, which is the one place the two
          // can differ — and the only place this line has anything extra to say.
          filteredCountLine(rows.length, serverRows.length, "ingredient"),
          statusFilter === "ACTIVE"
            ? "Active only"
            : statusFilter === "ARCHIVED"
              ? "Archived only"
              : "Active and archived",
          allergenFilter.length > 0 ? countLine(allergenFilter.length, "allergen filter") : null,
        )}
        actions={
          <PermissionGuard require="inventory.item.manage">
            <Button type="button" onClick={openCreate}>
              Add ingredient
            </Button>
          </PermissionGuard>
        }
      />

      {/* Status and allergens are not `filters` entries: status has no "off" position (its
          default IS a filter, so an "All categories"-shaped entry would be a lie), and allergens
          is a multi-select the strip has no shape for. Both are declared through
          `extraActiveCount` so the count sentence and "Clear all" stay truthful about controls
          the bar cannot see for itself. */}
      <FilterBar
        title="Ingredients"
        search={{
          value: search,
          onChange: setSearch,
          label: "Search ingredients",
          placeholder: "Search by name or SKU…",
        }}
        filters={[
          {
            id: "category",
            label: "Category",
            value: categoryFilter,
            onChange: setCategoryFilter,
            options: activeCategories.map((c) => ({ value: c.id, label: c.name })),
            isLoading: categoriesQuery.isLoading,
            error: categoriesQuery.isError,
            onRetry: () => void categoriesQuery.refetch(),
          },
        ]}
        extraActiveCount={(statusFilter === "ACTIVE" ? 0 : 1) + (allergenFilter.length > 0 ? 1 : 0)}
        onClearAll={() => {
          setCategoryFilter("");
          setSearch("");
          setStatusFilter("ACTIVE");
          setAllergenFilter([]);
        }}
      >
        <div className="flex min-w-40 flex-col gap-1">
          <label
            htmlFor="ingredient-status-filter"
            className="text-label font-semibold tracking-wide uppercase text-foreground-tertiary"
          >
            Status
          </label>
          <Select
            id="ingredient-status-filter"
            value={statusFilter}
            onValueChange={(value) => setStatusFilter(value as StatusFilter)}
            options={STATUS_OPTIONS}
          />
        </div>

        <div className="flex flex-col gap-1">
          <span className="text-label font-semibold tracking-wide uppercase text-foreground-tertiary">
            Allergens
          </span>
          <AllergenPillToggle
            value={allergenFilter}
            onChange={setAllergenFilter}
            className="max-w-md"
          />
        </div>
      </FilterBar>

      {/* GA-001: `isError` was never destructured, so an inventory-service failure rendered the
          "no ingredients yet" empty state — complete with an "Add ingredient" call to action
          inviting the user to re-key a store cupboard that already exists. */}
      <QueryBoundary
        query={ingredientsQuery}
        what="ingredients"
        isEmpty={rows.length === 0}
        loading={<DataGrid columns={columns} data={[]} isLoading />}
        empty={
          <PermissionGuard
            require="inventory.item.manage"
            fallback={<EmptyState title={EMPTY_TITLE} description={EMPTY_BODY} />}
          >
            <EmptyState
              title={EMPTY_TITLE}
              description={EMPTY_BODY}
              action={{ label: "Add ingredient", onClick: openCreate }}
            />
          </PermissionGuard>
        }
      >
        <DataGrid
          label="Ingredients"
          columns={columns}
          data={rows}
          density="comfortable"
          isFiltered={
            Boolean(categoryFilter) ||
            debouncedSearch.trim() !== "" ||
            allergenFilter.length > 0 ||
            statusFilter !== "ACTIVE"
          }
          onClearFilters={() => {
            setCategoryFilter("");
            setSearch("");
            setAllergenFilter([]);
            setStatusFilter("ACTIVE");
          }}
          card={{
            primary: (r) => r.name,
            secondary: (r) => `${r.categoryName ?? "Uncategorised"} · ${r.baseUomCode}`,
            trailing: (r) => (r.active ? "Active" : "Archived"),
          }}
        />
      </QueryBoundary>

      {/* Single shared create-or-edit dialog, fully controlled — driven by the header button and
          by every row's Edit action (which has no button of its own to compose a DialogTrigger
          from), mirroring CategoryFormDialog's controlled-dialog extension (08.2-14). */}
      <IngredientFormDialog
        key={
          formTarget?.mode === "edit" ? `edit-${formTarget.ingredient.id}` : "ingredient-form-idle"
        }
        ingredient={formTarget?.mode === "edit" ? formTarget.ingredient : undefined}
        open={formTarget !== null}
        onOpenChange={(next) => {
          if (!next) setFormTarget(null);
        }}
      />

      {/* Archive confirmation — no in-use refusal path for ingredients (unlike categories); a
          plain toast on error is acceptable, but the dialog only closes on success. */}
      <ConfirmDialog
        open={archiving !== null}
        onOpenChange={(next) => {
          if (!next) setArchiving(null);
        }}
        title={archiving ? `Archive "${archiving.name}"?` : "Archive ingredient"}
        body="Existing recipes, stock and purchase history keep referencing it; it disappears from pickers for new use."
        confirmLabel="Archive ingredient"
        pendingLabel="Archiving…"
        onConfirm={handleConfirmArchive}
        isPending={archiveIngredient.isPending}
      />
    </PageBody>
  );
}
