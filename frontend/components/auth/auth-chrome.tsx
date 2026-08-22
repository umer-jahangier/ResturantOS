import type { ReactNode } from "react";
import { Info } from "lucide-react";

/**
 * The shared vocabulary of the signed-out screens — the paint decisions the login card, the
 * forced-password-change panel and the two two-factor panels all have to make the same way.
 *
 * <h3>Why these are exported strings rather than an `<AuthField>` component</h3>
 *
 * Each call site still writes its own `FormField` / `FormItem` / `FormLabel`, because those carry
 * the react-hook-form wiring (`aria-describedby`, `aria-invalid`, `aria-required`) that
 * `components/ui/form.tsx` derives and that a bespoke wrapper would have to re-derive or
 * re-declare. What actually drifted between these screens was never the wiring; it was the
 * PAINT — one panel's labels at 14px sentence case, the next one's at 13px, controls at 32px
 * here and 36px there. So the paint is what is shared, as strings, and the structure stays where
 * the accessibility contract already lives.
 *
 * <h3>What is deliberately NOT here: a password reveal toggle</h3>
 *
 * One was written, and it was removed after the test run rather than after review, which is the
 * only reason it is worth recording. An eye button beside the field needs an accessible name, the
 * obvious name is "Show password", and that makes `getByLabel(/password/i)` match TWO nodes.
 * Eight cases in `__tests__/auth/login-form.test.tsx` went red instantly — and the worse failure
 * was the one no unit test would have shown: `e2e/fixtures/auth.fixture.ts` signs in EVERY persona
 * in the browser suite with `page.getByLabel("Password")`, which is strict, so a second matching
 * node would have failed every journey in the product for a convenience on one field.
 *
 * <p>This is the same trap the login form already documents one control further down — the
 * restaurant-identifier link had to be renamed because it began with "Sign in" and made
 * `getByRole("button", {name: "Sign in"})` ambiguous. On this screen, the accessible name of a
 * control is part of its contract with the rest of the repository.
 */

/**
 * Field labels: the same uppercase micro-label the sidebar's group headers and the DataGrid's
 * column headers already use (`--tracking-eyebrow`, 0.12em).
 *
 * <p>Case is applied with `text-transform`, which leaves `textContent` — and therefore the
 * accessible name — as written. That matters here more than anywhere else in the product, for
 * the reason above: these fields are found by their label text from two different test suites.
 */
export const authLabelClass =
  "text-label font-semibold tracking-eyebrow text-foreground-secondary uppercase";

/**
 * A 44px control with roomier padding and the body type role.
 *
 * <p>`Input` defaults to `h-8` (32px) and `text-base md:text-sm`, which is right for a dense
 * back-office grid and wrong for the one screen every user meets on a phone before they have any
 * context — WCAG 2.2 SC 2.5.5 asks for 44×44. `md:text-body` is spelled out alongside `text-body`
 * on purpose: tailwind-merge resolves a conflict within a breakpoint, so a bare `text-body` would
 * have left the base size overridden and `md:text-sm` still standing above 768px.
 */
export const authInputClass = "h-11 px-3.5 text-body md:text-body";

/**
 * The gold primary action, full width.
 *
 * <p>The glow is a `box-shadow`, deliberately — not a `filter: drop-shadow`. The compositing
 * family is refused anywhere under `app/` or `components/` by `zone-containment.test.ts`, because
 * `receipt-print.css` pins `.receipt-root` with `position: fixed` and any one of those properties
 * on an ancestor prints the app chrome onto a customer's bill. A box-shadow creates no containing
 * block, so it is the version of this effect that is allowed to exist.
 */
export const authPrimaryButtonClass =
  "h-11 w-full text-body font-semibold shadow-[0_8px_24px_-10px_color-mix(in_oklab,var(--primary-400)_65%,transparent)] disabled:shadow-none";

/** The quiet secondary action that sits under it — same height, no fill. */
export const authSecondaryButtonClass = "h-11 w-full text-body";

/**
 * The non-error notice: "your session expired", "that action needs a fresh code", "your new
 * password is saved".
 *
 * <p>`role="status"` and NOT `role="alert"`. `e2e/journeys/unified-login.spec.ts` case E reads
 * `getByRole("alert").first()` twice and asserts the two refusals are byte-identical — that is the
 * account-enumeration guardrail — so anything else on this card claiming the alert role would put
 * an unrelated string in front of the assertion. It is also simply true: none of these three are
 * failures, and announcing them assertively would interrupt a user who is mid-sentence in a field.
 */
export function AuthNotice({ children }: { children: ReactNode }) {
  return (
    <div
      role="status"
      className="flex items-start gap-3 rounded-lg border border-primary/25 bg-primary/8 px-3.5 py-3"
    >
      <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-primary" />
      <p className="text-small text-foreground-secondary">{children}</p>
    </div>
  );
}
