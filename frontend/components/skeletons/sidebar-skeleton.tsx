import { Skeleton } from "@/components/ui/skeleton";

const navTextWidths = [
  "w-24",
  "w-32",
  "w-20",
  "w-28",
  "w-36",
  "w-24",
  "w-32",
  "w-20",
  "w-28",
  "w-24",
] as const;

export function SidebarSkeleton() {
  return (
    <nav aria-label="Loading navigation" className="flex flex-col gap-1">
      {/* Brand placeholder */}
      <div className="mb-2 px-3 pt-2">
        <Skeleton className="h-8 w-32" />
      </div>

      {/* Branch switcher placeholder */}
      <div className="mb-4 px-3">
        <Skeleton className="h-9 w-full" />
      </div>

      {/* Nav item placeholders */}
      {navTextWidths.map((width, index) => (
        <div key={index} className="flex items-center gap-2 rounded-md px-3 py-2">
          <Skeleton className="h-5 w-5 shrink-0" />
          <Skeleton className={`h-4 ${width}`} />
        </div>
      ))}
    </nav>
  );
}
