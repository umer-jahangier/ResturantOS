"use client";

import Link from "next/link";
import { JournalEntryTable } from "@/components/finance/JournalEntryTable";
import { Button } from "@/components/ui/button";
import { PageBody } from "@/components/ui/page-body";
import { PageHeader } from "@/components/ui/page-header";

// URL: /app/finance/journal-entries
export default function JournalEntriesPage() {
  return (
    <PageBody className="space-y-(--space-lg)">
      {/* GA-094: this read "Tab to navigate rows, Enter to open, E to export". The first two
          were true. The third was never implemented — `JournalEntryTable`'s key handler had
          `if (e.key === "e" || e.key === "E") { // Export stub — Phase 7 }` with an EMPTY body,
          so pressing E did nothing at all, silently. Advertising a shortcut that does not exist
          is worse than offering no shortcuts: the user presses it, nothing happens, and they
          conclude the screen is broken rather than that the feature is absent.

          38-08: the row is a real button now rather than a `<tr tabIndex={0}>` with an Enter
          handler, so the sentence describes the grid's own keyboard behaviour instead of a
          bespoke one. */}
      <PageHeader
        title="Journal Entries"
        description="Search covers the whole branch ledger, not just the page on screen."
        actions={
          <Button asChild>
            <Link href="/app/finance/journal-entries/new">New Entry</Link>
          </Button>
        }
      />
      <JournalEntryTable />
    </PageBody>
  );
}
