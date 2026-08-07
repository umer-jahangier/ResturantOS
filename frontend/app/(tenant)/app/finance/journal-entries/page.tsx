"use client";

import Link from "next/link";
import { JournalEntryTable } from "@/components/finance/JournalEntryTable";
import { Button } from "@/components/ui/button";

// URL: /app/finance/journal-entries
export default function JournalEntriesPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Journal Entries</h1>
          {/* GA-094: this read "Tab to navigate rows, Enter to open, E to export". The first two
              are true. The third was never implemented — `JournalEntryTable`'s key handler had
              `if (e.key === "e" || e.key === "E") { // Export stub — Phase 7 }` with an EMPTY
              body, so pressing E did nothing at all, silently. Advertising a shortcut that does
              not exist is worse than offering no shortcuts: the user presses it, nothing happens,
              and they conclude the screen is broken rather than that the feature is absent.
              The dead branch is gone from the table; the claim goes with it, and comes back the
              day export does. */}
          <p className="text-sm text-muted-foreground">Tab to navigate rows, Enter to open</p>
        </div>
        <Button asChild>
          <Link href="/app/finance/journal-entries/new">New Entry</Link>
        </Button>
      </div>

      <JournalEntryTable />
    </div>
  );
}
