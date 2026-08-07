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
import type { Ingredient } from "@/lib/adapters/inventory.adapter";
import { AllergenPillToggle } from "@/components/inventory/allergen-pill-toggle";
import { IngredientFormDialog } from "@/components/inventory/IngredientFormDialog";
import { PermissionGuard } from "@/components/shared/permission-guard";
import { DataTable, type ColumnDef } from "@/components/ui/data-table";
import { StatusBadge } from "@/components/ui/status-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const EMPTY_TITLE = "No ingredients yet";
const EMPTY_BODY = "Add an ingredient to start building recipes and vendor catalogs.";

type IngredientFormTarget = { mode: "create" } | { mode: "edit"; ingredient: Ingredient };

type StatusFilter = "ACTIVE" | "ARCHIVED" | "ALL";

const selectClass =
  "h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm focus-visible:border-ring";

// URL: /app/inventory/ingredients — INV-01/INV-14's whole UI surface: create/search/filter/edit/
// archive ingredients (UI-SPEC Screen 2). Section tabs are owned by inventory/layout.tsx (08.2-14)
// and are not touched here.
export default function IngredientsPage() {
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, 300);
  const [categoryFilter, setCategoryFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("ACTIVE");
  const [allergenFilter, setAllergenFilter] = useState<string[]>([]);

  const { data: categories } = useCategories();
  const { data: ingredients, isLoading } = useIngredients({
    search: debouncedSearch.trim() || undefined,
    categoryId: categoryFilter || undefined,
    status: statusFilter,
  });
  const archiveIngredient = useArchiveIngredient();
  const restoreIngredient = useRestoreIngredient();

  const [formTarget, setFormTarget] = useState<IngredientFormTarget | null>(null);
  const [archiving, setArchiving] = useState<Ingredient | null>(null);

  const activeCategories = (categories ?? []).filter((c) => c.archivedAt == null);

  // Server-side search/category/status already narrowed `ingredients` (useIngredients' filters
  // argument); the allergen multi-select has no server-side filter param, so it's applied here —
  // a row matches if it carries ANY of the selected allergen codes (multi-select-as-OR).
  const rows = (ingredients ?? []).filter(
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
            <div className="text-xs text-muted-foreground">{row.original.shortName}</div>
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
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Ingredients</h1>
          <p className="text-sm text-muted-foreground">
            Create, search, edit and archive the ingredients your recipes and purchase orders draw
            from.
          </p>
        </div>
        <PermissionGuard require="inventory.item.manage">
          <Button type="button" onClick={openCreate}>
            Add ingredient
          </Button>
        </PermissionGuard>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[200px] flex-1">
          <Input
            placeholder="Search by name or SKU…"
            aria-label="Search ingredients"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <select
          aria-label="Filter by category"
          className={selectClass}
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
        >
          <option value="">All categories</option>
          {activeCategories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>

        <select
          aria-label="Filter by status"
          className={selectClass}
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
        >
          <option value="ACTIVE">Active</option>
          <option value="ARCHIVED">Archived</option>
          <option value="ALL">All</option>
        </select>

        <div className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">Allergens</span>
          <AllergenPillToggle
            value={allergenFilter}
            onChange={setAllergenFilter}
            className="max-w-md"
          />
        </div>
      </div>

      {isLoading ? (
        <DataTable columns={columns} data={[]} isLoading />
      ) : rows.length === 0 ? (
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
      ) : (
        <DataTable columns={columns} data={rows} />
      )}

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
      <Dialog
        open={archiving !== null}
        onOpenChange={(next) => {
          if (!next) setArchiving(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Archive ingredient</DialogTitle>
            <DialogDescription>
              {archiving
                ? `Archive "${archiving.name}"? Existing recipes, stock and purchase history keep referencing it; it disappears from pickers for new use.`
                : null}
            </DialogDescription>
          </DialogHeader>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setArchiving(null)}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={handleConfirmArchive}
              disabled={archiveIngredient.isPending}
            >
              {archiveIngredient.isPending ? "Archiving…" : "Archive ingredient"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
