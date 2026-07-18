"use client";

import { useMutation } from "@tanstack/react-query";
import { NlqRepository } from "@/lib/repositories/nlq.repository";
import type { ApiError } from "@/lib/api-client/errors";
import type { NlqResult } from "@/lib/models/nlq.model";

/**
 * NLQ-01/NLQ-02: ask a plain-English question, get rows + the executed SQL + a narrative back.
 *
 * A PINNED mutation (`useMutation<NlqResult, ApiError, {question: string}>`) — the explicit
 * `ApiError` type parameter is required so the page can branch on `error.code` / `error.status`
 * without importing `@/lib/api-client` directly, which the ESLint `no-restricted-imports`
 * boundary forbids inside `components/**` (decisions 04-02-C, 10-12-D).
 */
export function useNlqQuery() {
  return useMutation<NlqResult, ApiError, { question: string }>({
    mutationFn: (input) => NlqRepository.runQuery(input.question),
  });
}
