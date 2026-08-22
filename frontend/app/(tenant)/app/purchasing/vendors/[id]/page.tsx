"use client";

import { use, useState } from "react";
import Link from "next/link";
import { MoreHorizontal, TrendingDown, TrendingUp } from "lucide-react";
import { toast } from "sonner";

import {
  useArchiveVendorItem,
  useVendorItems,
  useVendorPriceChanges,
  useVendors,
} from "@/lib/hooks/purchasing/use-purchasing";
import type { VendorItem } from "@/lib/adapters/purchasing.adapter";
import { VendorCategoryTags } from "@/components/purchasing/VendorCategoryTags";
import { VendorItemFormDialog } from "@/components/purchasing/VendorItemFormDialog";
import { VendorItemPriceDialog } from "@/components/purchasing/VendorItemPriceDialog";
import { PermissionGuard } from "@/components/shared/permission-guard";
import { SectionSwitcher } from "@/components/shared/section-switcher";
import { DataTable, type ColumnDef } from "@/components/ui/data-table";
import { StatusBadge } from "@/components/ui/status-badge";
import { MoneyDisplay } from "@/components/ui/money-display";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { QueryErrorNotice } from "@/components/ui/query-boundary";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const EMPTY_CATALOG_TITLE = "No catalog items yet";
const EMPTY_CATALOG_BODY =
  "Add the items this vendor supplies so its prices show up on purchase-order lines.";

type CatalogFormTarget = { mode: "create" } | { mode: "edit"; vendorItem: VendorItem };

const SECTIONS = [
  { id: "catalog", label: "Catalog" },
  { id: "price-changes", label: "Price Changes" },
];

/**
 * URL: /app/purchasing/vendors/[id] — PUR-07's vendor detail page (UI-SPEC Screen 6). The flat
 * vendors list stays the place vendors themselves are created/edited (header CRUD); only catalog
 * and price-change management move here. Prices are append-only end to end: this page never
 * imports an update-price hook, only `VendorItemPriceDialog`'s create-only mutation.
 *
 * Split into a thin `use(params)`-unwrapping default export and a named `VendorDetailPageContent`
 * that takes a plain `vendorId` prop — the same App Router params-Promise convention every other
 * dynamic route page in this app uses, just with the body extracted so component tests can render
 * it directly without fighting React's `use()`/Suspense timing in jsdom (no consuming test exists
 * anywhere in this codebase for that pattern yet).
 */
export default function VendorDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <VendorDetailPageContent vendorId={id} />;
}

export function VendorDetailPageContent({ vendorId }: { vendorId: string }) {
  const {
    data: vendors,
    isLoading: isLoadingVendor,
    isError: isVendorError,
    error: vendorError,
    isFetching: isVendorFetching,
    refetch: refetchVendors,
  } = useVendors();
  const vendor = (vendors ?? []).find((v) => v.id === vendorId);

  const [section, setSection] = useState<string>("catalog");
  const [catalogFormTarget, setCatalogFormTarget] = useState<CatalogFormTarget | null>(null);
  const [priceTarget, setPriceTarget] = useState<VendorItem | null>(null);
  const [archiving, setArchiving] = useState<VendorItem | null>(null);

  const {
    data: vendorItems,
    isLoading: isLoadingItems,
    isError: isCatalogError,
  } = useVendorItems(vendorId);
  const {
    data: priceChanges,
    isLoading: isLoadingPriceChanges,
    isError: isPriceChangesError,
  } = useVendorPriceChanges(vendorId);
  const archiveVendorItem = useArchiveVendorItem(vendorId);

  function openCreateCatalogItem() {
    setCatalogFormTarget({ mode: "create" });
  }

  function openEditCatalogItem(vendorItem: VendorItem) {
    setCatalogFormTarget({ mode: "edit", vendorItem });
  }

  function handleConfirmArchive() {
    if (!archiving) return;
    archiveVendorItem.mutate(archiving.id, {
      onSuccess: () => {
        toast.success("Catalog item archived");
        setArchiving(null);
      },
      onError: (error) => {
        toast.error(error.message || "Could not archive this catalog item. Please try again.");
      },
    });
  }

  const catalogColumns: ColumnDef<VendorItem, unknown>[] = [
    {
      accessorKey: "vendorSku",
      header: "Vendor SKU",
      cell: ({ row }) => row.original.vendorSku ?? "—",
    },
    {
      accessorKey: "vendorDescription",
      header: "Description",
      cell: ({ row }) => row.original.vendorDescription ?? "—",
    },
    {
      id: "pack",
      header: "Pack",
      cell: ({ row }) =>
        `${row.original.packDescription ?? `${row.original.packQty} ${row.original.packUom}`}`,
    },
    {
      accessorKey: "orderUom",
      header: "Order unit",
    },
    {
      id: "currentPrice",
      header: "Current price",
      cell: ({ row }) =>
        row.original.currentUnitPricePaisa != null ? (
          <MoneyDisplay paisa={row.original.currentUnitPricePaisa} />
        ) : (
          "—"
        ),
    },
    {
      accessorKey: "minOrderQty",
      header: "Min order qty",
      cell: ({ row }) => row.original.minOrderQty ?? "—",
    },
    {
      accessorKey: "leadTimeDays",
      header: "Lead time (days)",
      cell: ({ row }) => row.original.leadTimeDays ?? "—",
    },
    {
      id: "status",
      header: "Status",
      cell: ({ row }) =>
        row.original.archivedAt == null ? (
          <StatusBadge status="active" label="Active" />
        ) : (
          <StatusBadge status="archived" label="Archived" />
        ),
    },
    {
      id: "ingredient",
      header: "Linked ingredient",
      cell: ({ row }) => (
        <Link
          href={`/app/inventory/ingredients?ingredientId=${row.original.ingredientId}`}
          className="text-primary hover:underline"
        >
          View ingredient
        </Link>
      ),
    },
    {
      id: "actions",
      header: "Actions",
      cell: ({ row }) => (
        <PermissionGuard require="vendor.manage">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={`Actions for ${row.original.vendorSku ?? row.original.id}`}
              >
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => openEditCatalogItem(row.original)}>
                Edit
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setPriceTarget(row.original)}>
                Record new price
              </DropdownMenuItem>
              <DropdownMenuItem variant="destructive" onSelect={() => setArchiving(row.original)}>
                Archive
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </PermissionGuard>
      ),
    },
  ];

  const priceChangeColumns: ColumnDef<NonNullable<typeof priceChanges>[number], unknown>[] = [
    {
      accessorKey: "vendorSku",
      header: "Item",
      cell: ({ row }) => row.original.vendorSku ?? row.original.vendorDescription ?? "—",
    },
    {
      accessorKey: "previousUnitPricePaisa",
      header: "Previous price",
      cell: ({ row }) =>
        row.original.previousUnitPricePaisa != null ? (
          <MoneyDisplay paisa={row.original.previousUnitPricePaisa} />
        ) : (
          "—"
        ),
    },
    {
      accessorKey: "newUnitPricePaisa",
      header: "New price",
      cell: ({ row }) => <MoneyDisplay paisa={row.original.newUnitPricePaisa} />,
    },
    {
      accessorKey: "deltaPct",
      header: "Delta",
      cell: ({ row }) => {
        const delta = row.original.deltaPct;
        if (delta == null) return "—";
        const pct = Number(delta);
        const isIncrease = pct > 0;
        const isDecrease = pct < 0;
        return (
          <span
            className={
              isIncrease
                ? "inline-flex items-center gap-1 text-warning"
                : isDecrease
                  ? "inline-flex items-center gap-1 text-success"
                  : "inline-flex items-center gap-1 text-muted-foreground"
            }
          >
            {isIncrease ? (
              <TrendingUp className="size-3.5" aria-hidden="true" />
            ) : isDecrease ? (
              <TrendingDown className="size-3.5" aria-hidden="true" />
            ) : null}
            <span>{`${pct > 0 ? "+" : ""}${pct.toFixed(2)}%`}</span>
          </span>
        );
      },
    },
    {
      accessorKey: "effectiveFrom",
      header: "Effective date",
      cell: ({ row }) => new Date(row.original.effectiveFrom).toLocaleDateString(),
    },
  ];

  if (isLoadingVendor) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-24" />
      </div>
    );
  }

  /*
   * A failed vendor read used to fall straight through to the header below, which renders
   * `vendor?.name ?? "Vendor"` and `vendor?.paymentTerms ?? "—"` — a detail page for a supplier,
   * with the supplier's name replaced by the word "Vendor" and every term an em dash. It looks
   * like a vendor record with nothing filled in, and a buyer reading it would conclude the
   * payment terms had never been set and raise the PO on default terms (GA-001).
   */
  if (isVendorError) {
    return (
      <QueryErrorNotice
        what="this vendor"
        moduleLabel="Purchasing"
        error={vendorError}
        isRetrying={isVendorFetching}
        onRetry={() => void refetchVendors()}
      />
    );
  }

  const catalogRows = vendorItems ?? [];
  const priceChangeRows = priceChanges ?? [];

  return (
    <div className="space-y-6">
      <Link href="/app/purchasing/vendors" className="text-sm text-primary">
        ← Vendors
      </Link>

      <div className="space-y-2">
        <h1 className="text-2xl font-semibold">{vendor?.name ?? "Vendor"}</h1>
        <p className="text-sm text-muted-foreground">
          {vendor?.paymentTerms ?? "—"}
          {vendor?.leadTimeDays != null ? ` · Lead time ${vendor.leadTimeDays} days` : ""}
          {vendor?.contactPerson ? ` · ${vendor.contactPerson}` : ""}
          {vendor?.phone ? ` · ${vendor.phone}` : ""}
        </p>
        <PermissionGuard
          require="vendor.manage"
          fallback={<VendorCategoryTags vendorId={vendorId} editable={false} />}
        >
          <VendorCategoryTags vendorId={vendorId} editable />
        </PermissionGuard>
      </div>

      <SectionSwitcher
        sections={SECTIONS}
        activeId={section}
        onChange={setSection}
        ariaLabel="Vendor sections"
      />

      {section === "catalog" && (
        <div id="section-catalog" className="space-y-4">
          <div className="flex items-center justify-between gap-4">
            <h2 className="text-xl font-semibold">Catalog</h2>
            <PermissionGuard require="vendor.manage">
              <Button type="button" onClick={openCreateCatalogItem}>
                Add catalog item
              </Button>
            </PermissionGuard>
          </div>

          {isCatalogError ? (
            <p className="rounded-md border border-destructive/30 bg-destructive/15 p-4 text-sm text-destructive">
              This module is temporarily unavailable. Try again in a moment.
            </p>
          ) : isLoadingItems ? (
            <DataTable columns={catalogColumns} data={[]} isLoading />
          ) : catalogRows.length === 0 ? (
            <PermissionGuard
              require="vendor.manage"
              fallback={<EmptyState title={EMPTY_CATALOG_TITLE} description={EMPTY_CATALOG_BODY} />}
            >
              <EmptyState
                title={EMPTY_CATALOG_TITLE}
                description={EMPTY_CATALOG_BODY}
                action={{ label: "Add catalog item", onClick: openCreateCatalogItem }}
              />
            </PermissionGuard>
          ) : (
            <DataTable columns={catalogColumns} data={catalogRows} />
          )}
        </div>
      )}

      {section === "price-changes" && (
        <div id="section-price-changes" className="space-y-4">
          <h2 className="text-xl font-semibold">Price Changes</h2>

          {isPriceChangesError ? (
            <p className="rounded-md border border-destructive/30 bg-destructive/15 p-4 text-sm text-destructive">
              This module is temporarily unavailable. Try again in a moment.
            </p>
          ) : isLoadingPriceChanges ? (
            <DataTable columns={priceChangeColumns} data={[]} isLoading />
          ) : priceChangeRows.length === 0 ? (
            <EmptyState
              title="No price changes yet"
              description="Price history for this vendor's catalog items will show up here once a price is recorded."
            />
          ) : (
            <DataTable columns={priceChangeColumns} data={priceChangeRows} />
          )}
        </div>
      )}

      {/* Single shared create-or-edit dialog for the catalog form, controlled — driven by the
          section header's "Add catalog item" CTA and by every row's Edit action, mirroring
          IngredientFormDialog's controlled-dialog convention (08.2-14). */}
      <VendorItemFormDialog
        key={
          catalogFormTarget?.mode === "edit"
            ? `edit-${catalogFormTarget.vendorItem.id}`
            : "vendor-item-form-idle"
        }
        vendorId={vendorId}
        vendorItem={catalogFormTarget?.mode === "edit" ? catalogFormTarget.vendorItem : undefined}
        open={catalogFormTarget !== null}
        onOpenChange={(next) => {
          if (!next) setCatalogFormTarget(null);
        }}
      />

      {/* The only price-write surface — always a create, never an in-place edit. */}
      {priceTarget && (
        <VendorItemPriceDialog
          key={priceTarget.id}
          vendorItem={priceTarget}
          open={priceTarget !== null}
          onOpenChange={(next) => {
            if (!next) setPriceTarget(null);
          }}
        />
      )}

      {/* Archive confirmation — matches the Copywriting Contract's archive-vendor-item copy. */}
      <ConfirmDialog
        open={archiving !== null}
        onOpenChange={(next) => {
          if (!next) setArchiving(null);
        }}
        title="Archive this catalog item?"
        body="Open purchase orders and price history are unaffected; it drops out of the PO line picker."
        confirmLabel="Archive item"
        pendingLabel="Archiving…"
        onConfirm={handleConfirmArchive}
        isPending={archiveVendorItem.isPending}
      />
    </div>
  );
}
