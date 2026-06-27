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
          <p className="text-sm text-muted-foreground">
            Tab to navigate rows, Enter to open, E to export
          </p>
        </div>
        <Button asChild>
          <Link href="/app/finance/journal-entries/new">New Entry</Link>
        </Button>
      </div>

      <JournalEntryTable />
    </div>
  );
}
