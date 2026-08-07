"use client";

import { useMutation } from "@tanstack/react-query";

import { SessionRepository } from "@/lib/repositories/session.repository";
import type { ApiError } from "@/lib/api-client/errors";
import type { TotpBootstrapBody, TotpSetup } from "@/lib/models/auth.model";

/**
 * First-time TOTP enrolment for an account that cannot log in until it has a second factor
 * (GA-008).
 *
 * <p>Deliberately NOT wired to the session store, unlike `useLogin`. Enrolment issues no
 * credential and must not be mistaken for authentication: the user completes it and then signs in
 * through the ordinary form, which is what keeps "you proved you hold this authenticator" and "you
 * are now logged in" as two separate events with two separate audit records.
 */
export function useTotpBootstrap() {
  return useMutation<TotpSetup, ApiError, TotpBootstrapBody>({
    mutationFn: (body) => SessionRepository.totpBootstrap(body),
  });
}

/** Activate the secret by proving the authenticator produces the right code. */
export function useTotpBootstrapVerify() {
  return useMutation<void, ApiError, TotpBootstrapBody>({
    mutationFn: (body) => SessionRepository.totpBootstrapVerify(body),
  });
}
