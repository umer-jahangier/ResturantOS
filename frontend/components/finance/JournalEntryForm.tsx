"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useCreateJe } from "@/lib/hooks/finance/use-journal-entries";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { CreateJeLineRequest } from "@/lib/models/finance.model";

interface JeLineState {
  accountCode: string;
  description: string;
  debitPaisa: string;
  creditPaisa: string;
}

function emptyLine(): JeLineState {
  return { accountCode: "", description: "", debitPaisa: "0", creditPaisa: "0" };
}

function JournalEntryForm() {
  const router = useRouter();
  const { mutate: createJe, isPending, error } = useCreateJe();

  const [entryDate, setEntryDate] = useState<string>(
    new Date().toISOString().split("T")[0] ?? "",
  );
  const [description, setDescription] = useState("");
  const [lines, setLines] = useState<JeLineState[]>([emptyLine(), emptyLine()]);

  const totalDebit = lines.reduce(
    (sum, l) => sum + (parseInt(l.debitPaisa || "0", 10) || 0),
    0,
  );
  const totalCredit = lines.reduce(
    (sum, l) => sum + (parseInt(l.creditPaisa || "0", 10) || 0),
    0,
  );
  const isBalanced = totalDebit === totalCredit && totalDebit > 0;

  function updateLine(index: number, field: keyof JeLineState, value: string) {
    setLines((prev) =>
      prev.map((line, i) => (i === index ? { ...line, [field]: value } : line)),
    );
  }

  function addLine() {
    setLines((prev) => [...prev, emptyLine()]);
  }

  function removeLine(index: number) {
    if (lines.length <= 2) return;
    setLines((prev) => prev.filter((_, i) => i !== index));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!isBalanced) return;

    const jeLines: CreateJeLineRequest[] = lines.map((l) => ({
      accountCode: l.accountCode,
      description: l.description,
      debitPaisa: parseInt(l.debitPaisa || "0", 10) || 0,
      creditPaisa: parseInt(l.creditPaisa || "0", 10) || 0,
    }));

    createJe(
      { entryDate, description, lines: jeLines },
      {
        onSuccess: (je) => {
          router.push(`/app/finance/journal-entries/${je.id}`);
        },
      },
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="entryDate">Entry Date</Label>
          <Input
            id="entryDate"
            type="date"
            value={entryDate}
            onChange={(e) => setEntryDate(e.target.value)}
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="description">Description</Label>
          <Input
            id="description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Journal entry description"
            required
          />
        </div>
      </div>

      <div className="space-y-2">
        <div className="grid grid-cols-[1fr_1fr_7rem_7rem_2rem] gap-2 text-xs font-medium text-muted-foreground">
          <span>Account Code</span>
          <span>Description</span>
          <span className="text-right">Debit (paisa)</span>
          <span className="text-right">Credit (paisa)</span>
          <span />
        </div>

        {lines.map((line, i) => (
          <div
            key={i}
            className="grid grid-cols-[1fr_1fr_7rem_7rem_2rem] gap-2"
          >
            <Input
              value={line.accountCode}
              onChange={(e) => updateLine(i, "accountCode", e.target.value)}
              placeholder="e.g. 1000"
              required
              className="font-mono"
            />
            <Input
              value={line.description}
              onChange={(e) => updateLine(i, "description", e.target.value)}
              placeholder="Line description"
            />
            <Input
              value={line.debitPaisa}
              onChange={(e) => updateLine(i, "debitPaisa", e.target.value)}
              type="number"
              min="0"
              placeholder="0"
              className="text-right font-mono tabular-nums"
            />
            <Input
              value={line.creditPaisa}
              onChange={(e) => updateLine(i, "creditPaisa", e.target.value)}
              type="number"
              min="0"
              placeholder="0"
              className="text-right font-mono tabular-nums"
            />
            <button
              type="button"
              onClick={() => removeLine(i)}
              className="text-muted-foreground hover:text-destructive disabled:opacity-30"
              disabled={lines.length <= 2}
              aria-label="Remove line"
            >
              ×
            </button>
          </div>
        ))}

        <Button type="button" variant="outline" size="sm" onClick={addLine}>
          + Add line
        </Button>
      </div>

      <div className="flex items-center justify-between rounded border p-3 text-sm">
        <div className="flex gap-6">
          <span>
            Total DR:{" "}
            <span className="font-mono tabular-nums font-medium">
              {totalDebit.toLocaleString()}
            </span>
          </span>
          <span>
            Total CR:{" "}
            <span className="font-mono tabular-nums font-medium">
              {totalCredit.toLocaleString()}
            </span>
          </span>
        </div>
        <span
          className={
            isBalanced
              ? "text-emerald-700 font-medium"
              : "text-destructive font-medium"
          }
        >
          {isBalanced ? "Balanced ✓" : "Not balanced"}
        </span>
      </div>

      {error && (
        <p className="text-sm text-destructive">
          {error instanceof Error ? error.message : "Failed to create journal entry"}
        </p>
      )}

      <div className="flex gap-3">
        <Button type="submit" disabled={!isBalanced || isPending}>
          {isPending ? "Saving…" : "Save as Draft"}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => router.push("/app/finance/journal-entries")}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}

export { JournalEntryForm };
