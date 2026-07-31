"use client";

import { useState } from "react";
import { toast } from "sonner";

import {
  useArchiveCategory,
  useCategoryTree,
  useMoveCategory,
  useRestoreCategory,
} from "@/lib/hooks/inventory/use-inventory";
import type { ItemCategory, ItemCategoryNode } from "@/lib/adapters/inventory.adapter";
import { CategoryTree } from "@/components/inventory/category-tree";
import { CategoryFormDialog } from "@/components/inventory/CategoryFormDialog";
import { PermissionGuard } from "@/components/shared/permission-guard";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const EMPTY_TITLE = "No categories yet";
const EMPTY_BODY =
  "Create a category to start organizing ingredients — categories drive GL account defaults.";

type CategoryFormTarget =
  | { mode: "create"; parentId: string | null }
  | { mode: "edit"; category: ItemCategory };

function flattenTree(nodes: ItemCategoryNode[]): ItemCategoryNode[] {
  const out: ItemCategoryNode[] = [];
  const walk = (list: ItemCategoryNode[]) => {
    for (const n of list) {
      out.push(n);
      walk(n.children);
    }
  };
  walk(nodes);
  return out;
}

/** How many ingredients sit under a node once its whole subtree is counted — drives the
 * move-success toast's "N ingredients' inherited GL account may change" summary. */
function countIngredientsInSubtree(node: ItemCategoryNode): number {
  return (
    node.category.ingredientCount +
    node.children.reduce((sum, child) => sum + countIngredientsInSubtree(child), 0)
  );
}

// URL: /app/inventory/categories — INV-13's whole UI surface: create/edit/reparent/archive a
// 3-level ingredient-category tree (UI-SPEC Screen 1).
export default function CategoriesPage() {
  const [showArchived, setShowArchived] = useState(false);
  const { data: tree, isLoading } = useCategoryTree(showArchived);
  const moveCategory = useMoveCategory();
  const archiveCategory = useArchiveCategory();
  const restoreCategory = useRestoreCategory();

  const [formTarget, setFormTarget] = useState<CategoryFormTarget | null>(null);
  const [archiving, setArchiving] = useState<ItemCategory | null>(null);
  const [archiveError, setArchiveError] = useState<string | null>(null);

  const nodes = tree ?? [];
  const flat = flattenTree(nodes);

  function openCreate(parentId: string | null) {
    setFormTarget({ mode: "create", parentId });
  }

  function openEdit(category: ItemCategory) {
    setFormTarget({ mode: "edit", category });
  }

  function handleMove(nodeId: string, targetId: string | null) {
    const node = flat.find((n) => n.category.id === nodeId);
    const impactCount = node ? countIngredientsInSubtree(node) : 0;
    moveCategory.mutate(
      { id: nodeId, input: { newParentId: targetId } },
      {
        onSuccess: () => {
          toast.success(
            impactCount > 0
              ? `Moved — ${impactCount} ingredient${impactCount === 1 ? "" : "s"}' inherited GL account may change.`
              : "Category moved.",
          );
        },
        onError: (error) => {
          toast.error(error.message || "Could not move the category. Please try again.");
        },
      },
    );
  }

  function handleArchiveRequest(category: ItemCategory) {
    setArchiveError(null);
    setArchiving(category);
  }

  function handleConfirmArchive() {
    if (!archiving) return;
    setArchiveError(null);
    archiveCategory.mutate(archiving.id, {
      onSuccess: () => {
        toast.success(`Archived ${archiving.name}`);
        setArchiving(null);
      },
      onError: (error) => {
        // Stays open on refusal (e.g. 409 CATEGORY_IN_USE) — never a toast-only failure the user
        // can miss; the server's message (with the live ingredient count) renders inline below.
        setArchiveError(error.message || "Could not archive this category. Please try again.");
      },
    });
  }

  function handleRestore(category: ItemCategory) {
    restoreCategory.mutate(category.id, {
      onSuccess: () => toast.success(`Restored ${category.name}`),
      onError: (error) => {
        toast.error(error.message || "Could not restore the category. Please try again.");
      },
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Categories</h1>
          <p className="text-sm text-muted-foreground">
            Organize ingredients into up to three levels — categories drive default GL account codes.
          </p>
        </div>
        <PermissionGuard require="inventory.item.manage">
          <Button type="button" onClick={() => openCreate(null)}>
            Add category
          </Button>
        </PermissionGuard>
      </div>

      {/* Archived categories still reserve their name (creating a new one with the same name is
          refused), so without this a manager can be told a name "already exists" while looking
          at a screen that shows nothing with that name — this is the only way to see, and
          restore, the category actually holding it. */}
      <label className="flex w-fit items-center gap-2 text-sm text-muted-foreground">
        <input
          type="checkbox"
          checked={showArchived}
          onChange={(e) => setShowArchived(e.target.checked)}
          className="size-4 rounded border-input"
        />
        Show archived
      </label>

      {isLoading ? (
        <div className="grid gap-2">
          <Skeleton className="h-10" />
          <Skeleton className="h-10" />
          <Skeleton className="h-10" />
        </div>
      ) : nodes.length === 0 ? (
        <PermissionGuard
          require="inventory.item.manage"
          fallback={<EmptyState title={EMPTY_TITLE} description={EMPTY_BODY} />}
        >
          <EmptyState
            title={EMPTY_TITLE}
            description={EMPTY_BODY}
            action={{ label: "Create category", onClick: () => openCreate(null) }}
          />
        </PermissionGuard>
      ) : (
        <CategoryTree
          nodes={nodes}
          onEdit={openEdit}
          onAddChild={(parent) => openCreate(parent.id)}
          onMove={handleMove}
          onArchive={handleArchiveRequest}
          onRestore={handleRestore}
          selectedId={formTarget?.mode === "edit" ? formTarget.category.id : null}
        />
      )}

      {/* Single shared create-or-edit dialog, fully controlled — driven by the header button and
          by every row's Edit / Add-subcategory action (neither of which has its own trigger
          button to compose a DialogTrigger from). */}
      <CategoryFormDialog
        key={
          formTarget
            ? formTarget.mode === "edit"
              ? `edit-${formTarget.category.id}`
              : `create-${formTarget.parentId ?? "root"}`
            : "category-form-idle"
        }
        category={formTarget?.mode === "edit" ? formTarget.category : undefined}
        defaultParentId={formTarget?.mode === "create" ? formTarget.parentId : undefined}
        open={formTarget !== null}
        onOpenChange={(next) => {
          if (!next) setFormTarget(null);
        }}
      />

      {/* Archive confirmation — stays open and shows the server's refusal message inline
          (role="alert") rather than a toast the user could miss (UI-SPEC Screen 1). */}
      <Dialog
        open={archiving !== null}
        onOpenChange={(next) => {
          if (!next) {
            setArchiving(null);
            setArchiveError(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Archive category</DialogTitle>
            <DialogDescription>
              {archiving
                ? `Archive "${archiving.name}"? Ingredients already assigned keep it; you won't be able to assign it to new ingredients until it's restored.`
                : null}
            </DialogDescription>
          </DialogHeader>

          {archiveError ? (
            <div role="alert" className="rounded-lg border bg-card px-2.5 py-2 text-sm text-destructive">
              {archiveError}
            </div>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setArchiving(null)}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={handleConfirmArchive}
              disabled={archiveCategory.isPending}
            >
              {archiveCategory.isPending ? "Archiving…" : "Archive category"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
