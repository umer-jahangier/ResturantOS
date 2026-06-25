"use client";

import { useMutation } from "@tanstack/react-query";
import { SessionRepository } from "@/lib/repositories/session.repository";
import { useSessionStore } from "@/lib/auth/session";
import type { ApiError } from "@/lib/api-client/errors";
import type { LoginBody, Session } from "@/lib/models/auth.model";

// Layer-3 hook: components call this, never the repository directly. On success
// the in-memory session (+ has_session marker) is set from the login response.
export function useLogin() {
  const setSession = useSessionStore((state) => state.setSession);

  return useMutation<Session, ApiError, LoginBody>({
    mutationFn: (body) => SessionRepository.login(body),
    onSuccess: (session) => setSession(session),
  });
}
