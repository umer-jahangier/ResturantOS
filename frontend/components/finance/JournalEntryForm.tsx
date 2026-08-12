"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCreateJe } from "@/lib/hooks/finance/use-journal-entries";
import { useOpenPeriods } from "@/lib/hooks/finance/use-periods";
import { useCurrentUser } from "@/lib/hooks/auth/use-current-user";
import { AccountCodeSelect } from "@/components/finance/AccountCodeSelect";
import { OpenPeriodDatePicker } from "@/components/finance/OpenPeriodDatePicker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MoneyDisplay } from "@/components/ui/money-display";
import { formatUserFacingError } from "@/lib/errors";
import { parseRupeesToPaisa } from "@/lib/adapters/shared";
import {
  describeEntryDateDefault,
  localIsoToday,
  resolveDefaultEntryDate,
} from "@/lib/utils/open-period-entry-date";
import type { CreateJeLineRequest } from "@/lib/models/finance.model";

/*
 * ── Why this form takes RUPEES ────────────────────────────────────────────────────────────────
 *
 * It used to ask for paisa. The columns read "Debit (paisa)" / "Credit (paisa)" over
 * `<Input type="number">` boxes whose handler was `parseInt(value, 10)`, and the running totals
 * printed the raw integer.
 *
 * That is the identical construction the Charge screen was carrying when it silently collected
 * Rs 345.60 against a Rs 3,456.80 bill (see the S1-05 note in lib/adapters/shared.ts), and it
 * fails the same two ways here:
 *
 *   1. An accountant typing a figure off a document — `1250.50` — gets `parseInt("1250.50")` =
 *      1250 paisa. Rs 12.50 posted against Rs 1,250.50 intended, in the general ledger, with
 *      debits equal to credits and therefore nothing anywhere to catch it.
 *   2. `type="number"` blanks its own `.value` on the intermediate `"1250."` keystroke, so the
 *      digits typed after the point land against an emptied field.
 *
 * Asking for paisa is not a validation problem; it is the wrong unit. The wire stays integer
 * paisa — `CreateJeLineRequest.debitPaisa` is unchanged — and the single conversion happens in
 * `parseRupeesToPaisa`, the same function the till uses, so there is one rounding rule in the
 * frontend and this screen does not get to invent a second one.
 */

interface JeLineState {
  accountCode: string;
  accountName: string;
  description: string;
  /** Exactly what the user typed, in rupees. Never a number: see note above. */
  debitText: string;
  creditText: string;
}

interface JeLineReading {
  debitPaisa: number;
  creditPaisa: number;
  debitInvalid: boolean;
  creditInvalid: boolean;
  bothSides: boolean;
}

function emptyLine(): JeLineState {
  return {
    accountCode: "",
    accountName: "",
    description: "",
    debitText: "",
    creditText: "",
  };
}

/** An empty box is a zero, not an error — a JE line normally has one side blank. */
function readAmount(text: string): { paisa: number; invalid: boolean } {
  if (text.trim() === "") return { paisa: 0, invalid: false };
  const paisa = parseRupeesToPaisa(text);
  return paisa === null ? { paisa: 0, invalid: true } : { paisa, invalid: false };
}

function JournalEntryForm() {
  const router = useRouter();
  const { branchId } = useCurrentUser();
  const { mutate: createJe, isPending, error } = useCreateJe();
  const periodsQuery = useOpenPeriods();
  const { data: openPeriods } = periodsQuery;

  /*
   * The default date used to be computed here as "today if today happens to fall inside
   * openPeriods[0], otherwise openPeriods[0].startDate", and rendered as a bare
   * `Selected: 2025-08-01` under a calendar still headed August 2026.
   *
   * That was not the screen reporting a closed book. `/finance/periods/open` returns 22 open
   * periods on this tenant and today sits inside the TWELFTH; the rule simply never looked past
   * the first. The search — and, for the days when the fallback really is needed, the sentence
   * that explains it — now live in one tested place.
   */
  const entryDateDefault = useMemo(
    () => resolveDefaultEntryDate(openPeriods, localIsoToday()),
    [openPeriods],
  );
  /*
   * GA-001 again, and it bit here first time out: an errored or still-loading periods query leaves
   * `openPeriods` undefined, which resolves to NO_OPEN_PERIODS — so a finance-service outage would
   * have printed "No accounting period is open" in the product's own confident voice. The sentence
   * is only allowed to speak for data that actually arrived; the picker below owns the other two
   * states and says which one it is.
   */
  const periodsAnswered = !periodsQuery.isPending && !periodsQuery.isError;
  const dateNotice = periodsAnswered ? describeEntryDateDefault(entryDateDefault) : null;

  // Only the user's explicit pick is stored; the effective date falls back to the resolved
  // default, which is empty until the open-periods query resolves. Storing the fallback in state
  // as well (via an effect) meant the same value lived in two places and cost an extra render
  // every time the query settled.
  const [pickedDate, setPickedDate] = useState("");
  const entryDate = pickedDate || entryDateDefault.date;
  const [description, setDescription] = useState("");
  const [lines, setLines] = useState<JeLineState[]>([emptyLine(), emptyLine()]);

  const readings: JeLineReading[] = lines.map((line) => {
    const debit = readAmount(line.debitText);
    const credit = readAmount(line.creditText);
    return {
      debitPaisa: debit.paisa,
      creditPaisa: credit.paisa,
      debitInvalid: debit.invalid,
      creditInvalid: credit.invalid,
      bothSides: debit.paisa > 0 && credit.paisa > 0,
    };
  });

  const totalDebitPaisa = readings.reduce((sum, r) => sum + r.debitPaisa, 0);
  const totalCreditPaisa = readings.reduce((sum, r) => sum + r.creditPaisa, 0);
  const isBalanced = totalDebitPaisa === totalCreditPaisa && totalDebitPaisa > 0;
  const hasValidAccounts = lines.every((line) => line.accountCode.length > 0);
  const hasInvalidAmount = readings.some((r) => r.debitInvalid || r.creditInvalid);
  const hasBothSides = readings.some((r) => r.bothSides);

  const canSubmit =
    isBalanced && hasValidAccounts && !hasInvalidAmount && !hasBothSides && !!branchId && !!entryDate;

  /** The one thing standing between the accountant and a saved entry, named. */
  const blockingReason = (() => {
    if (canSubmit) return null;
    // While the periods query is in flight or broken there is no honest advice to give about the
    // date; the picker is already showing the skeleton or the failure.
    if (!periodsAnswered) return null;
    if (!entryDate) return "Pick an entry date inside an open accounting period.";
    if (hasInvalidAmount) return "One of the amounts is not a rupee figure — see the message on that line.";
    if (hasBothSides) return "A line has both a debit and a credit — see the message on that line.";
    if (!hasValidAccounts) return "Choose an account on every line.";
    if (totalDebitPaisa === 0 && totalCreditPaisa === 0) return "Enter the amounts, in rupees.";
    if (!isBalanced) return "Debits and credits must be equal before this entry can be saved.";
    if (!branchId) return "No branch is selected for this session.";
    return null;
  })();

  function updateLine(index: number, field: keyof JeLineState, value: string) {
    setLines((prev) => prev.map((line, i) => (i === index ? { ...line, [field]: value } : line)));
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
    if (!canSubmit) return;

    const jeLines: CreateJeLineRequest[] = lines.map((l, i) => ({
      accountCode: l.accountCode,
      description: l.description,
      debitPaisa: readings[i]!.debitPaisa,
      creditPaisa: readings[i]!.creditPaisa,
    }));

    createJe(
      { entryDate, description, branchId, lines: jeLines },
      {
        onSuccess: (je) => {
          router.push(`/app/finance/journal-entries/${je.id}`);
        },
      },
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="space-y-1.5">
          <Label>Entry Date (open periods only)</Label>
          {dateNotice && (
            <p
              // Not role="alert": nothing has gone wrong and nothing the accountant did caused
              // this. It is the state of the books, stated before they read the calendar.
              data-testid="entry-date-notice"
              // The repo's warning-callout pairing (settings/appearance-form.tsx:242): the
              // `--warning` token rather than a raw amber literal, and `text-foreground` for the
              // body, which is what actually measures against a 10%-tinted surface.
              className="rounded-md border border-warning bg-warning/10 p-2.5 text-small text-foreground"
            >
              {dateNotice}{" "}
              <Link href="/app/finance/periods" className="font-medium underline underline-offset-2">
                Open Periods
              </Link>
            </p>
          )}
          <OpenPeriodDatePicker value={entryDate} onChange={setPickedDate} />
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
        <div className="hidden grid-cols-[1fr_1fr_8rem_8rem_2rem] gap-2 text-label font-medium text-muted-foreground md:grid">
          <span>Account</span>
          <span>Description</span>
          <span className="text-right">Debit (Rs)</span>
          <span className="text-right">Credit (Rs)</span>
          <span />
        </div>

        {lines.map((line, i) => {
          const reading = readings[i]!;
          return (
            <div
              key={i}
              data-testid="je-line"
              className="grid grid-cols-1 gap-2 rounded-lg border p-3 md:grid-cols-[1fr_1fr_8rem_8rem_2rem] md:items-start md:rounded-none md:border-0 md:p-0"
            >
              <label className="flex flex-col gap-1">
                <span className="text-label text-muted-foreground md:hidden">Account</span>
                <AccountCodeSelect
                  value={line.accountCode}
                  selectedName={line.accountName}
                  required
                  onChange={(account) => {
                    setLines((prev) =>
                      prev.map((row, index) =>
                        index === i
                          ? {
                              ...row,
                              accountCode: account.code,
                              accountName: account.name,
                            }
                          : row,
                      ),
                    );
                  }}
                />
              </label>

              <label className="flex flex-col gap-1">
                <span className="text-label text-muted-foreground md:hidden">Line description</span>
                <Input
                  value={line.description}
                  onChange={(e) => updateLine(i, "description", e.target.value)}
                  placeholder="Line description"
                  aria-label={`Line ${i + 1} description`}
                />
              </label>

              {/*
                type="text" + inputMode="decimal", NOT type="number" — a number input reports
                `.value === ""` on the intermediate "1250." keystroke, which is exactly how the
                old parseInt handler ate the digits after the decimal point.
              */}
              <label className="flex flex-col gap-1">
                <span className="text-label text-muted-foreground md:hidden">Debit (Rs)</span>
                <Input
                  value={line.debitText}
                  onChange={(e) => updateLine(i, "debitText", e.target.value)}
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  placeholder="0.00"
                  aria-label={`Line ${i + 1} debit (Rs)`}
                  aria-invalid={reading.debitInvalid || undefined}
                  className="text-right font-mono tabular-nums"
                />
              </label>

              <label className="flex flex-col gap-1">
                <span className="text-label text-muted-foreground md:hidden">Credit (Rs)</span>
                <Input
                  value={line.creditText}
                  onChange={(e) => updateLine(i, "creditText", e.target.value)}
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  placeholder="0.00"
                  aria-label={`Line ${i + 1} credit (Rs)`}
                  aria-invalid={reading.creditInvalid || undefined}
                  className="text-right font-mono tabular-nums"
                />
              </label>

              <div className="flex justify-end md:pt-1">
                <button
                  type="button"
                  onClick={() => removeLine(i)}
                  className="text-muted-foreground hover:text-destructive disabled:opacity-30"
                  disabled={lines.length <= 2}
                  aria-label={`Remove line ${i + 1}`}
                >
                  ×
                </button>
              </div>

              {(reading.debitInvalid || reading.creditInvalid || reading.bothSides) && (
                <p
                  role="alert"
                  data-testid={`je-line-error-${i}`}
                  className="text-small text-destructive md:col-span-5"
                >
                  {reading.debitInvalid && reading.creditInvalid
                    ? `Line ${i + 1} debit and credit: enter the amount in rupees, like 1250.50.`
                    : reading.debitInvalid
                      ? `Line ${i + 1} debit: enter the amount in rupees, like 1250.50.`
                      : reading.creditInvalid
                        ? `Line ${i + 1} credit: enter the amount in rupees, like 1250.50.`
                        : `Line ${i + 1} has both a debit and a credit. Put the amount on one side only.`}
                </p>
              )}
            </div>
          );
        })}

        <Button type="button" variant="outline" size="sm" onClick={addLine}>
          + Add line
        </Button>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3 text-body">
        <div className="flex flex-wrap gap-6">
          <span>
            Total DR:{" "}
            <MoneyDisplay paisa={totalDebitPaisa} className="font-mono" />
          </span>
          <span>
            Total CR:{" "}
            <MoneyDisplay paisa={totalCreditPaisa} className="font-mono" />
          </span>
        </div>
        <span
          // `text-success` rather than the raw `text-emerald-700` this line used to carry: the
          // literal had no dark-theme pair and rendered near-black on the dark surface.
          className={isBalanced ? "font-medium text-success" : "font-medium text-destructive"}
        >
          {isBalanced ? "Balanced ✓" : "Not balanced"}
        </span>
      </div>

      {error && (
        <p className="text-body text-destructive" role="alert">
          {formatUserFacingError(error)}
        </p>
      )}

      <div className="space-y-2">
        <div className="flex gap-3">
          <Button type="submit" disabled={!canSubmit || isPending}>
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
        {blockingReason && (
          <p data-testid="submit-blocked-reason" className="text-small text-muted-foreground">
            {blockingReason}
          </p>
        )}
      </div>
    </form>
  );
}

export { JournalEntryForm };
