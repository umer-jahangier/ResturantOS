import { post } from "@/lib/api-client/request";

/**
 * The signed-in user acting on their OWN account.
 *
 * <p>Separate from `user.repository.ts` because the authorization model is different in kind, not
 * in degree: everything there is gated on an administration authority and names a target; nothing
 * here names a target at all.
 */

export interface ChangeOwnPasswordBody {
  currentPassword: string;
  newPassword: string;
}

export const UserProfileRepository = {
  /**
   * `POST /api/v1/auth/change-password` (plan 13-04).
   *
   * <p><b>There is deliberately no field naming the account.</b> The subject comes from the
   * authenticated principal and from nowhere else; auth-service's DTO has nowhere to put a target,
   * which is the cheapest possible way to never have a horizontal-privilege-escalation bug on this
   * endpoint. Sending `userId` does nothing — that is asserted in `PasswordChangeIT`.
   *
   * <p>It requires the CURRENT password as well as a valid token. Both, always: a token alone would
   * turn a leaked access token into a permanent account takeover, because the change locks the real
   * owner out.
   *
   * <p>Not public at either layer — absent from auth-service's `permitAll` list and from the
   * gateway's `PUBLIC_PATHS`, where only the fully-qualified `/change-password/forced` is
   * registered. `isPublicPath` matches with `startsWith`, so the bare path must never be added
   * there; it would expose this endpoint too.
   *
   * <p>Nothing is parsed back because there is nothing to parse: the endpoint answers `{data:null}`
   * and issues no credential. The existing session stays valid — only OTHER sessions' refresh
   * tokens are revoked.
   */
  async changeOwnPassword(body: ChangeOwnPasswordBody): Promise<void> {
    await post<ChangeOwnPasswordBody>("/api/v1/auth/change-password", body);
  },
};
