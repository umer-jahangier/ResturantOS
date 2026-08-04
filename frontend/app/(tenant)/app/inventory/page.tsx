import Link from "next/link";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

// Inventory landing page — a real entry point (not a redirect). Sub-pages own their own data
// fetching; this is a static Server Component (mirrors purchasing's page.tsx).
const SECTIONS = [
  {
    href: "/app/inventory/recipes",
    label: "Recipe Builder",
    description: "Author versioned recipes for your synced menu items.",
  },
  {
    href: "/app/inventory/coverage",
    label: "Coverage",
    description: "See which active menu items still need a recipe.",
  },
];

export default function InventoryPage() {
  return (
    <div>
      <h1 className="text-xl font-semibold">Inventory</h1>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
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
