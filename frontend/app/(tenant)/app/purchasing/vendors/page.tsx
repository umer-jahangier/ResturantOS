"use client";

import Link from "next/link";

import { useVendors } from "@/lib/hooks/purchasing/use-purchasing";
import { VendorFormDialog } from "@/components/purchasing/VendorFormDialog";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { QueryBoundary } from "@/components/ui/query-boundary";
import { Skeleton } from "@/components/ui/skeleton";

export default function VendorsPage() {
  // GA-001: `isError` is destructured. It was not, and `data ?? []` two lines down turned every
  // failed request into "No vendors yet" — the product telling an owner their suppliers do not
  // exist because purchasing-service returned a 500.
  const vendors = useVendors();
  const rows = vendors.data ?? [];

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Vendors</h1>
        <VendorFormDialog trigger={<Button>Add vendor</Button>} />
      </div>

      <QueryBoundary
        className="mt-4"
        query={vendors}
        what="vendors"
        isEmpty={rows.length === 0}
        loading={
          <div className="mt-4 grid gap-2">
            <Skeleton className="h-16" />
            <Skeleton className="h-16" />
          </div>
        }
        empty={
          <EmptyState
            className="mt-4"
            title="No vendors yet"
            description="Use “Add vendor” to create your first vendor and start raising purchase orders."
          />
        }
      >
        <ul className="mt-4 divide-y rounded border">
          {rows.map((v) => (
            <li key={v.id} className="flex items-center justify-between gap-4 px-4 py-3">
              <div className="min-w-0">
                <div className="font-medium">{v.name}</div>
                <div className="text-sm text-muted-foreground">
                  {v.paymentTerms}
                  {v.contactPerson ? ` · ${v.contactPerson}` : ""}
                  {/* Last four digits only — the API never returns the full account (PUR-01). */}
                  {v.bankAccountLast4 ? ` · Bank •••• ${v.bankAccountLast4}` : ""}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Link
                  href={`/app/purchasing/vendors/${v.id}`}
                  className="text-sm text-primary hover:underline"
                >
                  Manage catalog →
                </Link>
                <VendorFormDialog
                  vendor={v}
                  trigger={
                    <Button variant="outline" size="sm">
                      Edit
                    </Button>
                  }
                />
              </div>
            </li>
          ))}
        </ul>
      </QueryBoundary>
    </div>
  );
}
