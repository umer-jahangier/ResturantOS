"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

import { useVendors } from "@/lib/hooks/purchasing/use-purchasing";
import { countLine, filteredCountLine, statLine } from "@/lib/format/stat-line";
import type { Vendor } from "@/lib/adapters/purchasing.adapter";
import { VendorFormDialog } from "@/components/purchasing/VendorFormDialog";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { DataGrid, type ColumnDef } from "@/components/ui/data-grid/data-grid";
import { FilterBar } from "@/components/ui/filter-bar";
import { PageBody } from "@/components/ui/page-body";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { QueryBoundary } from "@/components/ui/query-boundary";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/ui/status-badge";

const STATUS_OPTIONS = [
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" },
] as const;

/**
 * Vendor directory.
 *
 * <h3>Why this file changed shape</h3>
 *
 * It was a `<ul>` of 63 sub-44px controls — and that matters beyond the target sizes, because a
 * migration scoped to "files containing `<table>`" would never have found it. Half this product's
 * back office is list-shaped, not table-shaped: users, settings, roles, crm, branches and this
 * screen. They are all still grids to the reader; only the markup disagreed.
 *
 * <p>So it is a `DataGrid` now: sticky header, one row height, pagination, and a card list below
 * `md` instead of a row whose two actions collided on a phone.
 */
export default function VendorsPage() {
  // GA-001: `isError` is destructured. It was not, and `data ?? []` two lines down turned every
  // failed request into "No vendors yet" — the product telling an owner their suppliers do not
  // exist because purchasing-service returned a 500.
  const vendors = useVendors();
  const allRows = useMemo(() => vendors.data ?? [], [vendors.data]);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return allRows.filter((v) => {
      if (statusFilter === "active" && !v.active) return false;
      if (statusFilter === "inactive" && v.active) return false;
      if (needle === "") return true;
      return [v.name, v.contactPerson, v.email, v.phone]
        .filter((field): field is string => typeof field === "string")
        .some((field) => field.toLowerCase().includes(needle));
    });
  }, [allRows, search, statusFilter]);

  const isFiltered = search.trim() !== "" || statusFilter !== "";
  const activeCount = rows.filter((v) => v.active).length;

  const columns: ColumnDef<Vendor, unknown>[] = [
    {
      accessorKey: "name",
      header: "Vendor",
      cell: ({ row }) => (
        <div className="flex items-center gap-(--space-sm)">
          {/* The initials avatar exists precisely for a 32px cell — a supplier list is scanned by
              shape long before it is read, and this is the only column with anything to give. */}
          <Avatar name={row.original.name} toneKey={row.original.id} size="sm" />
          <div className="min-w-0">
            <div className="font-medium">{row.original.name}</div>
            {row.original.contactPerson ? (
              <div className="text-small text-muted-foreground">{row.original.contactPerson}</div>
            ) : null}
          </div>
        </div>
      ),
    },
    { accessorKey: "paymentTerms", header: "Payment terms" },
    {
      accessorKey: "leadTimeDays",
      header: "Lead time",
      cell: ({ row }) =>
        row.original.leadTimeDays == null ? "—" : `${row.original.leadTimeDays} days`,
    },
    {
      id: "bank",
      header: "Bank",
      // Last four digits only — the API never returns the full account (PUR-01).
      cell: ({ row }) =>
        row.original.bankAccountLast4 ? `•••• ${row.original.bankAccountLast4}` : "—",
    },
    {
      id: "status",
      header: "Status",
      cell: ({ row }) =>
        row.original.active ? (
          <StatusBadge status="active" label="Active" />
        ) : (
          <StatusBadge status="archived" label="Inactive" />
        ),
    },
    {
      id: "actions",
      header: "Actions",
      cell: ({ row }) => (
        <div className="flex items-center justify-end gap-(--space-sm)">
          <Button asChild variant="ghost" size="sm">
            <Link href={`/app/purchasing/vendors/${row.original.id}`}>Manage catalog</Link>
          </Button>
          <VendorFormDialog
            vendor={row.original}
            trigger={
              <Button variant="outline" size="sm">
                Edit
              </Button>
            }
          />
        </div>
      ),
    },
  ];

  return (
    <PageBody className="space-y-(--space-lg)">
      <PageHeader
        title="Vendors"
        description="Who you buy from, on what terms, and how long they take to deliver."
        // The demo's Vendors screen carries a stat line and NO KPI row (DEMO-SCREENS §8), and
        // that is the right call here too: every number worth a tile is a count of the very rows
        // below it. Both parts are derived from `rows` — the same array handed to the grid.
        meta={statLine(
          filteredCountLine(rows.length, allRows.length, "vendor"),
          countLine(activeCount, "active"),
        )}
        actions={<VendorFormDialog trigger={<Button>Add vendor</Button>} />}
      />

      <FilterBar
        title="Vendor directory"
        search={{
          value: search,
          onChange: setSearch,
          label: "Search vendors",
          placeholder: "Search by name or contact…",
        }}
        filters={[
          {
            id: "status",
            label: "Status",
            value: statusFilter,
            onChange: setStatusFilter,
            options: STATUS_OPTIONS,
            allLabel: "Active and inactive",
          },
        ]}
      />

      <QueryBoundary
        query={vendors}
        what="vendors"
        isEmpty={allRows.length === 0}
        loading={
          <div className="grid gap-2">
            <Skeleton className="h-16" />
            <Skeleton className="h-16" />
          </div>
        }
        empty={
          <EmptyState
            title="No vendors yet"
            description="Use “Add vendor” to create your first vendor and start raising purchase orders."
          />
        }
      >
        <DataGrid
          label="Vendors"
          columns={columns}
          data={rows}
          density="comfortable"
          isFiltered={isFiltered}
          onClearFilters={() => {
            setSearch("");
            setStatusFilter("");
          }}
          card={{
            primary: (v) => v.name,
            secondary: (v) =>
              [v.paymentTerms, v.contactPerson, v.active ? null : "Inactive"]
                .filter(Boolean)
                .join(" · "),
            actions: (v) => (
              <>
                <Button asChild variant="ghost" size="sm">
                  <Link href={`/app/purchasing/vendors/${v.id}`}>Manage catalog</Link>
                </Button>
                <VendorFormDialog
                  vendor={v}
                  trigger={
                    <Button variant="outline" size="sm">
                      Edit
                    </Button>
                  }
                />
              </>
            ),
          }}
        />
      </QueryBoundary>
    </PageBody>
  );
}
