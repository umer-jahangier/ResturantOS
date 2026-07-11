"use client";

import { useVendors } from "@/lib/hooks/purchasing/use-purchasing";

export default function VendorsPage() {
  const { data, isLoading } = useVendors();
  if (isLoading) return <p>Loading vendors…</p>;
  return (
    <div>
      <h1 className="text-xl font-semibold">Vendors</h1>
      <ul className="mt-4 divide-y rounded border">
        {(data ?? []).map((v) => (
          <li key={v.id} className="px-4 py-3">
            <div className="font-medium">{v.name}</div>
            <div className="text-sm text-muted-foreground">{v.paymentTerms}</div>
          </li>
        ))}
      </ul>
    </div>
  );
}
