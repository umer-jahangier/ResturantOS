"use client";

import { useMutation } from "@tanstack/react-query";

import {
  UserProfileRepository,
  type ChangeOwnPasswordBody,
} from "@/lib/repositories/user-profile.repository";

/**
 * Self-service password change.
 *
 * <p>No query cache is touched on success, and that is not an omission. `changeOwnPassword` calls
 * `revokeActiveRefreshSessions(userId)`, which revokes EVERY unrevoked refresh session for the user
 * — including the one this browser is holding (auth-service `PasswordPolicyService:218-225`, read
 * rather than assumed). The current access token keeps working until it expires and then the next
 * refresh fails.
 *
 * <p>So there is no cache state worth repairing: the correct next step is to end the session
 * deliberately and say so, rather than leave the user in a session that will die at an
 * unpredictable moment and look like a bug. The profile screen does exactly that.
 */
export function useChangeOwnPassword() {
  return useMutation({
    mutationFn: (body: ChangeOwnPasswordBody) => UserProfileRepository.changeOwnPassword(body),
  });
}

export type { ChangeOwnPasswordBody };
