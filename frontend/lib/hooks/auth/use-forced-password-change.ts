"use client";

import { useMutation } from "@tanstack/react-query";
import { SessionRepository } from "@/lib/repositories/session.repository";
import type { ApiError } from "@/lib/api-client/errors";
import type { ForcedPasswordChangeBody } from "@/lib/models/auth.model";

/**
 * Layer-3 hook for the forced password change (D-17).
 *
 * Deliberately does NOT touch the session store on success. `POST /api/v1/auth/change-password/forced`
 * issues no access token and sets no refresh cookie — it changes a password and nothing else — so
 * setting a session here would fabricate one the user has not authenticated for. The caller sends
 * them back to `/login`.
 */
export function useForcedPasswordChange() {
  return useMutation<void, ApiError, ForcedPasswordChangeBody>({
    mutationFn: (body) => SessionRepository.forcedPasswordChange(body),
  });
}
