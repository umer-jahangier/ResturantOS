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

/** NLQ-01: a textarea + submit, with example questions so an empty box isn't a dead end. */
export function NlqAskBox({ onAsk, isPending }: NlqAskBoxProps) {
  const [question, setQuestion] = useState("");

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = question.trim();
    if (!trimmed || isPending) return;
    onAsk(trimmed);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <label htmlFor="nlq-question" className="text-sm font-medium">
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
        className="w-full resize-none rounded-lg border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50"
      />

      <div className="flex flex-wrap gap-2">
        {EXAMPLE_QUESTIONS.map((example) => (
          <button
            key={example}
            type="button"
            disabled={isPending}
            onClick={() => setQuestion(example)}
            className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground hover:bg-muted disabled:opacity-50"
          >
            {example}
          </button>
        ))}
      </div>

      <Button type="submit" disabled={isPending || !question.trim()}>
        {isPending ? "Asking…" : "Ask"}
      </Button>

      {isPending && (
        <div className="space-y-2" aria-hidden="true">
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-4 w-1/2" />
        </div>
      )}
    </form>
  );
}
