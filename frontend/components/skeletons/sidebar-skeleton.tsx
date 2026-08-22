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

/**
 * The Suspense fallback for `<Sidebar>` (`app/(tenant)/layout.tsx`).
 *
 * <h3>Why this file changed with the shell</h3>
 *
 * It had no width and no ground of its own, so while the sidebar suspended, the rail was a
 * zero-width column on the page colour — the header and the content slid 240px left and then
 * snapped back when the real one mounted. A skeleton whose job is to hold a place has to hold
 * the right place: `w-60` and `bg-sidebar` are the same two values `sidebar.tsx` renders, and
 * the brand block is given the real one's height so the first row of nav lands where it will
 * stay.
 *
 * <p>Rows are full-bleed with a 20px inset, matching the slab geometry the demo uses and the
 * real nav now uses — an inset, rounded placeholder promises a shape the sidebar no longer has.
 */
export function SidebarSkeleton() {
  return (
    <nav
      aria-label="Loading navigation"
      className="hidden w-60 flex-col border-r border-sidebar-border bg-sidebar md:flex"
    >
      {/* Brand placeholder — the real block is a 36px mark on a 20px/16px padding rhythm. */}
      <div className="flex items-center gap-2.5 border-b border-sidebar-border px-5 pt-5 pb-4">
        <Skeleton className="size-9 shrink-0 rounded-lg" />
        <Skeleton className="h-8 w-28" />
      </div>

      {/* Branch switcher placeholder */}
      <div className="border-b border-sidebar-border px-4 py-3">
        <Skeleton className="h-8 w-full" />
      </div>

      {/* Nav item placeholders */}
      <div className="flex flex-col py-2.5">
        {navTextWidths.map((width, index) => (
          <div key={index} className="flex items-center gap-2.5 px-5 py-2">
            <Skeleton className="size-4 shrink-0" />
            <Skeleton className={`h-4 ${width}`} />
          </div>
        ))}
      </div>
    </nav>
  );
}
