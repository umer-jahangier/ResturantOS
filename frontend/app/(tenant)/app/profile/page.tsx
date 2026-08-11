"use client";

import { ChangePasswordForm } from "@/components/settings/change-password-form";
import { ProfilePanel } from "@/components/settings/profile-panel";

/**
 * Your profile — GA-019.
 *
 * <p>`/settings/profile` and `/app/profile` were both 404s, and the profile dropdown had been
 * reduced to `My Account | Appearance | Log out` because every other entry pointed at a page that
 * did not exist. For six of the eight seeded roles the menu was Log out alone. Meanwhile
 * `POST /api/v1/auth/change-password` had shipped in plan 13-04, tested, and been wired only for
 * the FORCED variant — so a signed-in user could not change their own password although the
 * endpoint had worked for months.
 *
 * <p><b>No permission guard, deliberately.</b> Every authenticated user has a profile and every
 * authenticated user may change their own password: the endpoint's authorization is "you are signed
 * in", the target is the token's subject and there is no field for anyone else. A guard here would
 * lock people out of their own account for holding too few permissions, which is the opposite of
 * what this page is for.
 */
export default function ProfilePage() {
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Your profile</h1>
        <p className="text-sm text-muted-foreground">
          Who you are signed in as, and how to change your password.
        </p>
      </div>

      <ProfilePanel />
      <ChangePasswordForm />
    </div>
  );
}
