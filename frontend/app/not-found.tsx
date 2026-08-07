import Link from "next/link";

/**
 * The product had no `not-found.tsx` anywhere, so every unbuilt or mistyped route rendered
 * Next.js's own bare page: the words "404: This page could not be found." on a white background,
 * with **zero anchors and zero navigation**. A user who reached one — by bookmark, by a stale
 * link, or by the two nav entries GA-053 and GA-091 left unguarded — had no way back into the
 * app except the browser's Back button.
 *
 * Marking the dead nav entries `comingSoon` (GA-053, GA-091) removes the two links that led here.
 * This removes the dead END: any route that does not resolve now says so in the product's own
 * voice and offers a way out. The two fixes are complementary — one stops the product offering
 * doors that open onto nothing, the other makes sure the room behind any such door has an exit.
 *
 * Deliberately server-rendered and dependency-free: it must work when the session, the API and
 * the feature flags are all unavailable, which is precisely when a user is most likely to hit it.
 */
export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
      <p className="font-mono text-sm text-muted-foreground">404</p>
      <h1 className="text-2xl font-semibold">This page doesn&apos;t exist</h1>
      <p className="max-w-md text-sm text-muted-foreground">
        The link may be out of date, or the screen may not be built yet. Nothing has gone wrong with
        your data.
      </p>
      <Link
        href="/app/dashboard"
        className="rounded-lg border px-4 py-2 text-sm font-medium hover:bg-muted"
      >
        Back to dashboard
      </Link>
    </main>
  );
}
