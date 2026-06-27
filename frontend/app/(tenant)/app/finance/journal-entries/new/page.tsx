import { JournalEntryForm } from "@/components/finance/JournalEntryForm";

// URL: /app/finance/journal-entries/new
export default function NewJournalEntryPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">New Journal Entry</h1>
        <p className="text-sm text-muted-foreground">
          Debits must equal credits before saving.
        </p>
      </div>

      <JournalEntryForm />
    </div>
  );
}
