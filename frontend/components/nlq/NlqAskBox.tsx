"use client";

import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

const EXAMPLE_QUESTIONS = [
  "What was revenue last week?",
  "Which items sold most yesterday?",
  "What was our average order value this month?",
];

interface NlqAskBoxProps {
  onAsk: (question: string) => void;
  isPending: boolean;
}

/**
 * NLQ-01: a textarea + submit, with example questions so an empty box isn't a dead end.
 *
 * <p>Re-typeset onto the contract roles (N12): the label was `text-sm`, the textarea `text-sm`
 * and the example chips `text-xs` — three of Tailwind's stock steps on a screen whose siblings
 * use `--text-body` / `--text-small` / `--text-label`. The example chips are `Button`s now
 * rather than bare `<button>`s with a hand-written border, so they carry the shared focus ring
 * and the 44px target the rest of the product's controls do.
 */
export function NlqAskBox({ onAsk, isPending }: NlqAskBoxProps) {
  const [question, setQuestion] = useState("");

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = question.trim();
    if (!trimmed || isPending) return;
    onAsk(trimmed);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-(--space-sm)">
      <label htmlFor="nlq-question" className="block text-small font-medium">
        Ask a question about your restaurant&apos;s data
      </label>
      <textarea
        id="nlq-question"
        aria-label="Ask a question"
        value={question}
        onChange={(e) => setQuestion(e.target.value)}
        placeholder="e.g. What was revenue last week?"
        rows={3}
        disabled={isPending}
        className="w-full resize-none rounded-lg border border-input bg-transparent px-3 py-2 text-body focus-visible:border-ring disabled:opacity-50"
      />

      <div className="flex flex-wrap gap-(--space-sm)">
        {EXAMPLE_QUESTIONS.map((example) => (
          <Button
            key={example}
            type="button"
            variant="outline"
            size="sm"
            disabled={isPending}
            onClick={() => setQuestion(example)}
          >
            {example}
          </Button>
        ))}
      </div>

      <Button type="submit" disabled={isPending || !question.trim()}>
        {isPending ? "Asking…" : "Ask"}
      </Button>

      {isPending && (
        <div className="space-y-(--space-sm)" aria-hidden="true">
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-4 w-1/2" />
        </div>
      )}
    </form>
  );
}
