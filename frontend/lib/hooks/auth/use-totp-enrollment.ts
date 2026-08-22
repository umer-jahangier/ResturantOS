"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { SessionRepository } from "@/lib/repositories/session.repository";
import type { ApiError } from "@/lib/api-client/errors";
import type {
  RecoveryCodes,
  TotpBootstrapBody,
  TotpSetup,
  TwoFactorStatus,
} from "@/lib/models/auth.model";

const TWO_FACTOR_STATUS_KEY = ["auth", "2fa", "status"] as const;

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

/**
 * Activate the secret by proving the authenticator produces the right code.
 *
 * Resolves with the account's recovery codes. They are not cached and not refetchable — the server
 * keeps only digests — so the component that calls this owns the single opportunity to show them.
 */
export function useTotpBootstrapVerify() {
  return useMutation<RecoveryCodes, ApiError, TotpBootstrapBody>({
    mutationFn: (body) => SessionRepository.totpBootstrapVerify(body),
  });
}

/** Whether the signed-in user has a second factor, and how many recovery codes remain. */
export function useTwoFactorStatus() {
  return useQuery<TwoFactorStatus, ApiError>({
    queryKey: TWO_FACTOR_STATUS_KEY,
    queryFn: () => SessionRepository.totpStatus(),
  });
}

/** Issues a secret for a signed-in user. Activates nothing until {@link useTotpVerify} succeeds. */
export function useTotpSetup() {
  return useMutation<TotpSetup, ApiError, string | undefined>({
    mutationFn: (currentCode) => SessionRepository.totpSetup(currentCode),
  });
}

/**
 * Activates the secret and resolves with the recovery codes.
 *
 * Invalidates the status query so the panel stops offering enrolment, but the CODES themselves are
 * returned to the caller and never cached — a cache entry holding them would keep plaintext in
 * memory long after the screen that needed it, for a value nothing is allowed to refetch.
 */
export function useTotpVerify() {
  const queryClient = useQueryClient();
  return useMutation<RecoveryCodes, ApiError, string>({
    mutationFn: (code) => SessionRepository.totpVerify(code),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: TWO_FACTOR_STATUS_KEY }),
  });
}

/** Replaces the recovery-code set. Requires a live authenticator code. */
export function useRegenerateRecoveryCodes() {
  const queryClient = useQueryClient();
  return useMutation<RecoveryCodes, ApiError, string>({
    mutationFn: (code) => SessionRepository.totpRegenerateRecoveryCodes(code),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: TWO_FACTOR_STATUS_KEY }),
  });
}

/** Turns the second factor off. Accepts an authenticator code or a recovery code. */
export function useTotpDisable() {
  const queryClient = useQueryClient();
  return useMutation<void, ApiError, string>({
    mutationFn: (code) => SessionRepository.totpDisable(code),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: TWO_FACTOR_STATUS_KEY }),
  });
}
