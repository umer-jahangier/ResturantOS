import Link from "next/link";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

// Purchasing landing page — a real entry point (not a redirect). Sub-pages
// own their own data fetching; this is a static Server Component.
const SECTIONS = [
  {
    href: "/app/purchasing/vendors",
    label: "Vendors",
    description: "Manage vendor records, payment terms and contacts.",
  },
  {
    href: "/app/purchasing/purchase-orders",
    label: "Purchase Orders",
    description: "Raise, approve and track purchase orders through receipt.",
  },
  {
    href: "/app/purchasing/invoices",
    label: "Invoices",
    description: "Match vendor invoices against POs and goods receipts.",
  },
  {
    href: "/app/purchasing/payments",
    label: "Payments",
    description: "Record and track payments against approved invoices.",
  },
  {
    href: "/app/purchasing/analytics",
    label: "Analytics",
    description: "Spend trends, price variance and vendor scorecards.",
  },
];

export default function PurchasingPage() {
  return (
    <div>
      <h1 className="text-xl font-semibold">Purchasing</h1>

      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {SECTIONS.map((section) => (
          <Link key={section.href} href={section.href}>
            <Card className="h-full transition-colors hover:bg-accent/50">
              <CardHeader>
                <CardTitle>{section.label}</CardTitle>
                <CardDescription>{section.description}</CardDescription>
              </CardHeader>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
