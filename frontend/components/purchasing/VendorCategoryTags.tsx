"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import {
  useReplaceVendorCategories,
  useVendorCategories,
} from "@/lib/hooks/purchasing/use-purchasing";
import type { VendorCategory } from "@/lib/adapters/purchasing.adapter";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

// The invariant caption — rendered verbatim from the UI-SPEC and the Copywriting Contract; every
// call site (editable or read-only, empty or populated) must show this exact text so the D-01
// "filter/suggest only, never authorizes" invariant reaches the user, not just the data model
// (T-08.2-183). Never re-derive this string per call site.
const FILTER_ONLY_CAPTION =
  "Used to filter and suggest — does not restrict what can be ordered.";

interface VendorCategoryTagsProps {
  vendorId: string;
  /** Read-only pills when false (no add/remove affordance); aria-pressed-style edit UI when true. */
  editable: boolean;
  className?: string;
}

/**
 * PUR-07: vendor category tags (UI-SPEC Screen 6). These are filter/suggestion metadata only —
 * `VendorCategoryController`'s own contract states they are never consulted by any authorization
 * decision, so the caption below is not decorative: it is how that invariant reaches the user.
 * It always renders, including when the tag list is empty (T-08.2-183).
 */
export function VendorCategoryTags({ vendorId, editable, className }: VendorCategoryTagsProps) {
  const { data: categories, isLoading } = useVendorCategories(vendorId);
  const replaceCategories = useReplaceVendorCategories(vendorId);

  const [newTagName, setNewTagName] = useState("");

  // No local "draft" copy is kept — the query result is the single source of truth. Every
  // add/remove mutates directly off the latest server list and relies on the mutation's own
  // invalidation (useReplaceVendorCategories) to refresh `categories`, so the tags shown always
  // reflect what is actually persisted, never an optimistic guess that silently failed.
  const tags = categories ?? [];

  function persist(next: VendorCategory[]) {
    replaceCategories.mutate(
      next.map((t) => ({ categoryId: t.categoryId, categoryName: t.categoryName, preferred: t.preferred })),
      {
        onError: (error) => {
          toast.error(error.message || "Could not update category tags. Please try again.");
        },
      },
    );
  }

  function removeTag(categoryId: string) {
    persist(tags.filter((t) => t.categoryId !== categoryId));
  }

  function addTag() {
    const name = newTagName.trim();
    if (!name) return;
    if (tags.some((t) => t.categoryName.toLowerCase() === name.toLowerCase())) {
      setNewTagName("");
      return;
    }
    // Client-generated id — a bare filter/suggestion tag, not a real category-master reference;
    // the server is the source of truth for whatever id it assigns/echoes back on the next fetch.
    const id = typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `local-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    persist([...tags, { categoryId: id, categoryName: name, preferred: false }]);
    setNewTagName("");
  }

  if (isLoading) {
    return <p className={cn("text-sm text-muted-foreground", className)}>Loading category tags…</p>;
  }

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <div role="group" aria-label="Vendor category tags" className="flex flex-wrap items-center gap-1.5">
        {tags.length === 0 && !editable ? (
          <span className="text-sm text-muted-foreground">No category tags yet.</span>
        ) : (
          tags.map((tag) =>
            editable ? (
              <button
                key={tag.categoryId}
                type="button"
                aria-pressed={true}
                onClick={() => removeTag(tag.categoryId)}
                disabled={replaceCategories.isPending}
                className="inline-flex items-center gap-1 rounded-full border border-primary bg-primary/10 px-3 py-1 text-sm text-primary transition-colors disabled:cursor-not-allowed disabled:opacity-50"
              >
                {tag.categoryName}
                <X className="size-3.5" aria-hidden="true" />
              </button>
            ) : (
              <span
                key={tag.categoryId}
                className="inline-flex items-center rounded-full border border-border px-3 py-1 text-sm text-muted-foreground"
              >
                {tag.categoryName}
              </span>
            ),
          )
        )}
      </div>

      {editable && (
        <div className="flex items-center gap-2">
          <Input
            aria-label="New category tag"
            placeholder="Add a tag…"
            value={newTagName}
            onChange={(e) => setNewTagName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addTag();
              }
            }}
            className="h-8 max-w-48"
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={addTag}
            disabled={replaceCategories.isPending || newTagName.trim() === ""}
          >
            Add tag
          </Button>
        </div>
      )}

      {/* Not decorative — the D-01 invariant must always be visible here, empty list or not. */}
      <p className="text-sm text-muted-foreground">{FILTER_ONLY_CAPTION}</p>
    </div>
  );
}
