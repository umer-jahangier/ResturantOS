"use client";

import { use, useState } from "react";
import Link from "next/link";
import { useFieldArray, useForm } from "react-hook-form";
import { z } from "zod";
import { toast } from "sonner";

import { createZodResolver } from "@/lib/forms/zod-resolver";
import { calendarDateToInstant } from "@/lib/forms/calendar-date";
import { useCurrentUser } from "@/lib/hooks/auth/use-current-user";
import {
  useCreateRecipe,
  useIngredients,
  useMenuItemCatalog,
  useRecipeCostPreview,
  useRecipeVersions,
  useUoms,
} from "@/lib/hooks/inventory/use-inventory";
import type { PreviewRecipeCostInput, Recipe, RecipeInput } from "@/lib/adapters/inventory.adapter";
import { RecipeVersionStrip } from "@/components/inventory/RecipeVersionStrip";
import { RecipeCostLineShare, RecipeCostPanel } from "@/components/inventory/recipe-cost-panel";
import { PermissionGuard } from "@/components/shared/permission-guard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";

const selectClass =
  "h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm focus-visible:border-ring";

// Every numeric field is a string here because that is what an <input>/<select> yields; mirrors
// RecipeFormDialog.tsx's exact convention (conversion to the wire shape happens on submit).
const lineFormSchema = z.object({
  ingredientId: z.string().min(1, "Ingredient is required"),
  qty: z.string().refine((v) => v.trim() !== "" && Number(v) > 0, "Enter a positive quantity"),
  uomCode: z.string().min(1, "Unit is required"),
  yieldPct: z.string().optional(),
});

const revisionFormSchema = z.object({
  yieldServings: z
    .string()
    .refine((v) => v.trim() !== "" && Number(v) > 0, "Enter a positive yield"),
  effectiveFrom: z.string().optional(),
  name: z.string().optional(),
  lines: z.array(lineFormSchema).min(1, "Add at least one ingredient line"),
});

type RevisionFormValues = z.infer<typeof revisionFormSchema>;

const EMPTY_LINE = { ingredientId: "", qty: "", uomCode: "", yieldPct: "" };

/**
 * PRE-FILLED from the currently selected version — never blank (D-05). `effectiveFrom` always
 * starts blank; it is the NEW revision's own effective date, not the prior version's.
 */
function defaultValuesFromVersion(version: Recipe | undefined): RevisionFormValues {
  if (!version) {
    return { yieldServings: "1", effectiveFrom: "", name: "", lines: [EMPTY_LINE] };
  }
  return {
    yieldServings: version.yieldServings,
    effectiveFrom: "",
    name: version.name ?? "",
    lines: version.lines.map((l) => ({
      ingredientId: l.ingredientId,
      qty: l.qty,
      uomCode: l.uomCode,
      yieldPct: l.yieldPct != null ? String(l.yieldPct) : "",
    })),
  };
}

function toRecipeInput(values: RevisionFormValues, menuItemId: string): RecipeInput {
  return {
    menuItemId,
    yieldServings: values.yieldServings,
    name: values.name?.trim() ? values.name.trim() : undefined,
    effectiveFrom:
      values.effectiveFrom && values.effectiveFrom.trim() !== ""
        ? calendarDateToInstant(values.effectiveFrom)
        : undefined,
    lines: values.lines.map((l) => ({
      ingredientId: l.ingredientId,
      qty: l.qty.trim(),
      uomCode: l.uomCode.trim(),
      yieldPct: l.yieldPct && l.yieldPct.trim() !== "" ? Number(l.yieldPct) : undefined,
    })),
  };
}

// URL: /app/inventory/recipes/[menuItemId] — INV-15's dedicated recipe detail + revision-
// authoring page (UI-SPEC Screen 3). Every version's lines are viewable read-only; "Create new
// revision" always pre-fills a fresh editable line form from the currently selected version and
// always saves as a NEW version via `useCreateRecipe` — there is no save-in-place control anywhere
// on this page and no update hook is imported (D-05, T-08.2-161). The right column is a sticky
// live plate-cost panel driven by a single cost-preview query regardless of whether the left
// column is showing a read-only version or an in-progress draft.
export default function RecipeDetailPage({ params }: { params: Promise<{ menuItemId: string }> }) {
  const { menuItemId } = use(params);
  const { branchId } = useCurrentUser();
  const { data: menuItems } = useMenuItemCatalog();
  const { data: ingredients } = useIngredients();
  const { data: uoms } = useUoms();
  const { data: versions, isLoading } = useRecipeVersions(menuItemId);
  const createRecipe = useCreateRecipe();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isAuthoring, setIsAuthoring] = useState(false);

  const menuItem = (menuItems ?? []).find((mi) => mi.menuItemId === menuItemId);
  const sortedVersions = [...(versions ?? [])].sort((a, b) => b.version - a.version);
  const nowMs = Date.now();
  const effectiveVersion =
    sortedVersions.find((v) => new Date(v.effectiveFrom).getTime() <= nowMs) ?? sortedVersions[0];
  const selectedVersion =
    sortedVersions.find((v) => v.id === selectedId) ?? effectiveVersion ?? sortedVersions[0];

  const form = useForm<RevisionFormValues>({
    resolver: createZodResolver(revisionFormSchema),
    defaultValues: defaultValuesFromVersion(selectedVersion),
  });

  const { fields, append, remove } = useFieldArray({ control: form.control, name: "lines" });

  function startAuthoring() {
    form.reset(defaultValuesFromVersion(selectedVersion));
    setIsAuthoring(true);
  }

  function cancelAuthoring() {
    setIsAuthoring(false);
  }

  function onSubmit(values: RevisionFormValues) {
    createRecipe.mutate(toRecipeInput(values, menuItemId), {
      onSuccess: (recipe) => {
        toast.success("Recipe version created");
        setIsAuthoring(false);
        setSelectedId(recipe.id);
      },
      onError: (error) => {
        toast.error(error.message || "Could not create the recipe version. Please try again.");
      },
    });
  }

  const watchedLines = form.watch("lines");
  const watchedYieldServings = form.watch("yieldServings");

  // The preview input tracks whichever data currently backs the left column: the in-progress
  // draft while authoring, or the read-only selected version otherwise — so the panel is always
  // live for a draft and always shows the real cost breakdown for a saved version.
  const previewLines: PreviewRecipeCostInput["lines"] = isAuthoring
    ? (watchedLines ?? [])
        .filter((l) => l.ingredientId && l.qty.trim() !== "" && l.uomCode)
        .map((l) => ({
          ingredientId: l.ingredientId,
          qty: l.qty.trim(),
          uomCode: l.uomCode.trim(),
          yieldPct: l.yieldPct && l.yieldPct.trim() !== "" ? Number(l.yieldPct) : undefined,
        }))
    : (selectedVersion?.lines ?? []).map((l) => ({
        ingredientId: l.ingredientId,
        qty: l.qty,
        uomCode: l.uomCode,
        yieldPct: l.yieldPct != null ? Number(l.yieldPct) : undefined,
      }));

  const previewYieldServings = isAuthoring
    ? watchedYieldServings || "1"
    : (selectedVersion?.yieldServings ?? "1");

  const previewInput: PreviewRecipeCostInput = {
    branchId,
    menuItemId,
    yieldServings: previewYieldServings,
    lines: previewLines,
  };

  const { data: preview, isFetching } = useRecipeCostPreview(previewInput);
  const isFirstLoad = preview === undefined && previewLines.length > 0;

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Loading recipe…</p>;
  }

  const hasVersions = sortedVersions.length > 0;

  return (
    <div className="space-y-6">
      <Link href="/app/inventory/recipes" className="text-sm text-primary">
        ← Recipes
      </Link>

      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{menuItem?.name ?? "Recipe"}</h1>
          <p className="text-sm text-muted-foreground">
            View ingredient lines version by version and author a new revision.
          </p>
        </div>
        {!isAuthoring && (
          <PermissionGuard require="inventory.item.manage">
            <Button type="button" onClick={startAuthoring}>
              {hasVersions ? "Create new revision" : "Create first recipe version"}
            </Button>
          </PermissionGuard>
        )}
      </div>

      {!hasVersions && !isAuthoring ? (
        <PermissionGuard
          require="inventory.item.manage"
          fallback={
            <EmptyState
              title="No recipe versions yet"
              description={`${menuItem?.name ?? "This menu item"} has no recipe version yet.`}
            />
          }
        >
          <EmptyState
            title="No recipe versions yet"
            description={`${menuItem?.name ?? "This menu item"} has no recipe version yet.`}
            action={{ label: "Create first recipe version", onClick: startAuthoring }}
          />
        </PermissionGuard>
      ) : (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
          <div className="space-y-4">
            {!isAuthoring && hasVersions && selectedVersion && (
              <>
                <RecipeVersionStrip
                  versions={sortedVersions}
                  selectedId={selectedVersion.id}
                  onSelect={setSelectedId}
                />

                <p className="text-sm text-foreground">
                  v{selectedVersion.version} ·{" "}
                  {new Date(selectedVersion.effectiveFrom).getTime() > nowMs
                    ? `scheduled from ${new Date(selectedVersion.effectiveFrom).toLocaleDateString()}`
                    : `active since ${new Date(selectedVersion.effectiveFrom).toLocaleDateString()}`}
                </p>

                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-muted-foreground">
                      <th className="py-2 pr-4">Ingredient</th>
                      <th className="py-2 pr-4">Qty</th>
                      <th className="py-2 pr-4">Unit</th>
                      <th className="py-2 pr-4">Yield %</th>
                      <th className="py-2 pr-4">Share of plate cost</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedVersion.lines.map((line) => {
                      const costLine = preview?.lines.find(
                        (l) => l.ingredientId === line.ingredientId,
                      );
                      return (
                        <tr key={line.id} className="border-b">
                          <td className="py-2 pr-4">
                            {(ingredients ?? []).find((i) => i.id === line.ingredientId)?.name ??
                              line.ingredientId}
                          </td>
                          <td className="py-2 pr-4">{line.qty}</td>
                          <td className="py-2 pr-4">{line.uomCode}</td>
                          <td className="py-2 pr-4">{line.yieldPct ?? "—"}</td>
                          <td className="py-2 pr-4">
                            {costLine ? <RecipeCostLineShare line={costLine} /> : "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </>
            )}

            {isAuthoring && (
              <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" noValidate>
                  <p className="text-sm text-foreground">Draft — unsaved</p>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <FormField
                      control={form.control}
                      name="yieldServings"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Yield (servings)</FormLabel>
                          <FormControl>
                            <Input inputMode="decimal" placeholder="1" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="name"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Recipe name</FormLabel>
                          <FormControl>
                            <Input placeholder="Optional" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="effectiveFrom"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Effective from</FormLabel>
                          <FormControl>
                            <Input type="date" {...field} />
                          </FormControl>
                          <p className="text-xs text-muted-foreground">
                            Leave blank to start now. A future date schedules the recipe — it will
                            not deplete stock or count towards coverage until then.
                          </p>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-medium">Ingredient lines</h3>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => append(EMPTY_LINE)}
                      >
                        Add line
                      </Button>
                    </div>

                    {fields.map((f, idx) => {
                      const lineIngredientId = form.watch(`lines.${idx}.ingredientId`);
                      const costLine = preview?.lines.find(
                        (l) => l.ingredientId === lineIngredientId,
                      );
                      return (
                        <div
                          key={f.id}
                          className="grid grid-cols-[1fr_1fr_1fr_1fr_auto] items-end gap-2 rounded border p-2"
                        >
                          <FormField
                            control={form.control}
                            name={`lines.${idx}.ingredientId`}
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel className="text-xs">Ingredient</FormLabel>
                                <FormControl>
                                  <select
                                    {...field}
                                    aria-label="Ingredient"
                                    className={selectClass}
                                  >
                                    <option value="">Select…</option>
                                    {(ingredients ?? []).map((i) => (
                                      <option key={i.id} value={i.id}>
                                        {i.name}
                                      </option>
                                    ))}
                                  </select>
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                          <FormField
                            control={form.control}
                            name={`lines.${idx}.qty`}
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel className="text-xs">Qty</FormLabel>
                                <FormControl>
                                  <Input inputMode="decimal" placeholder="0.2" {...field} />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                          <FormField
                            control={form.control}
                            name={`lines.${idx}.uomCode`}
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel className="text-xs">Unit</FormLabel>
                                <FormControl>
                                  <select {...field} aria-label="Unit" className={selectClass}>
                                    <option value="">Select…</option>
                                    {(uoms ?? []).map((u) => (
                                      <option key={u.id} value={u.code}>
                                        {u.code}
                                      </option>
                                    ))}
                                  </select>
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                          <FormField
                            control={form.control}
                            name={`lines.${idx}.yieldPct`}
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel className="text-xs">Yield %</FormLabel>
                                <FormControl>
                                  <Input inputMode="decimal" placeholder="Optional" {...field} />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                          <div className="flex flex-col items-end gap-1">
                            {costLine && <RecipeCostLineShare line={costLine} />}
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              disabled={fields.length === 1}
                              onClick={() => remove(idx)}
                            >
                              Remove
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <div className="flex gap-2">
                    <Button type="button" variant="outline" onClick={cancelAuthoring}>
                      Cancel
                    </Button>
                    <Button type="submit" disabled={createRecipe.isPending}>
                      {createRecipe.isPending ? "Saving…" : "Save revision"}
                    </Button>
                  </div>
                </form>
              </Form>
            )}
          </div>

          <div className="sticky top-6 self-start">
            <RecipeCostPanel
              preview={preview}
              isFetching={isFetching}
              isFirstLoad={isFirstLoad}
              menuItemName={menuItem?.name}
            />
          </div>
        </div>
      )}
    </div>
  );
}
