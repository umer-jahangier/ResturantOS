import { ForcedPasswordChangeForm } from "@/components/auth/forced-password-change-form";
import { sanitizeReturnPath } from "@/lib/auth/step-up";

/**
 * URL: `/login/change-password` — where a `403 PASSWORD_CHANGE_REQUIRED` lands.
 *
 * <b>This screen did not exist before 16a-01, and its absence was a live dead end.</b> 13-08 built
 * `POST /api/v1/auth/change-password/forced` and made it public at the gateway; 13-06 and 13-11 set
 * `must_change_password` on every provisioned and every created account. So every newly provisioned
 * user — including the first admin of every new tenant — hit a 403 the browser had no screen for.
 * They could not sign in, and nothing in the UI told them why or what to do.
 *
 * The `?token=` is the single-use change token auth-service put in the refusal's `details`. It is
 * useless on its own: the endpoint demands the current password as well, which is why carrying it
 * in a URL is acceptable here and why this page still asks for that password rather than trying to
 * smuggle it through the redirect.
 */
interface PageProps {
  searchParams: Promise<{ token?: string; email?: string; tenant?: string; next?: string }>;
}

export default async function ForcedPasswordChangePage({ searchParams }: PageProps) {
  const params = await searchParams;

  return (
    <ForcedPasswordChangeForm
      changeToken={params.token ?? null}
      email={params.email ?? null}
      tenantSlug={params.tenant ?? null}
      // Sanitised here rather than at the redirect, for the same reason the login page does it:
      // `next` is whatever the URL said, and an off-site value must never reach the router.
      returnPath={sanitizeReturnPath(params.next)}
    />
  );
}
