import { redirect } from "next/navigation";

/**
 * `/login/change-password` — kept as a redirect, and deliberately inert.
 *
 * <h3>What this route used to be, and why it is not that any more (F12)</h3>
 *
 * 16a-01 built this as the screen a `403 PASSWORD_CHANGE_REQUIRED` lands on, and the only way to
 * get the single-use change token here was the query string: `?token=…&email=…`. That URL is
 * written to browser history, sent as the `Referer` of the next request the page makes, and logged
 * verbatim by every proxy and gateway between the browser and the API. The full-shift walkthrough
 * caught a new hire meeting it on their first minute in the product.
 *
 * The forced change now happens inside the login form itself, where the token is a prop in memory
 * and the address bar never moves off `/login` — see `components/auth/forced-password-change-form.tsx`.
 *
 * <h3>Why a redirect rather than a deleted file</h3>
 *
 * Old links exist: in the history of anyone who onboarded before this change, in proxy logs, and in
 * the phase records that quote the URL. A 404 would tell those users nothing. This sends them to
 * the one place that can actually help — signing in again mints a fresh token, which is cheap,
 * because a change token is only ever issued to someone who has just supplied the correct password.
 *
 * <b>It must never grow a `searchParams` argument again.</b> Reading `?token=` here would restore
 * the exact leak this page was emptied to close, and forwarding the query onto `/login` would carry
 * it into the next history entry as well. The redirect is unconditional and parameterless on purpose.
 */
export default function ForcedPasswordChangePage(): never {
  redirect("/login");
}
