import * as React from "react";
import { CheckCircle2, CircleDashed, KeyRound, XCircle } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  tenantUserStanding,
  tenantUserStandingLabel,
  type TenantUserRow,
  type TenantUserStanding,
} from "@/lib/models/platform.model";

/**
 * What an operator can act on about one account, in one chip.
 *
 * <h3>Why four states and not two</h3>
 *
 * "Active / inactive" is the shape of `users.is_active` and it is not the shape of the question.
 * Two of the four readings below are the ones a platform operator actually opens this console
 * for:
 *
 * <ul>
 *   <li><b>Never signed in</b> — the account was provisioned and has never been used.
 *       `last_login_at` is the ONLY activity signal this platform records about a person, and its
 *       null is the visible form of a restaurant whose administrator cannot get in. It is a
 *       standing of its own, never a blank date cell.</li>
 *   <li><b>Password change due</b> — usable, but the next sign-in is a forced change. An operator
 *       who has just issued a temporary password is looking for exactly this row.</li>
 * </ul>
 *
 * <p>There is deliberately no "locked" reading here: a directory row does not carry `lockedUntil`
 * — the upstream summary has no such field — and inferring one would be a fabricated column. Lock
 * state exists only on the user detail endpoint and is shown only on the detail screen.
 *
 * <h3>Why not `StatusBadge`</h3>
 *
 * Its variant union is POS and finance vocabulary (`PENDING`, `SERVED`, `VOIDED`), and widening a
 * shared primitive so the control plane can borrow it would push platform-tier states into every
 * till's type surface — the same call `tenant-badges.tsx` made for tenant status. The GEOMETRY is
 * `StatusBadge`'s verbatim, down to its `bg-x/10 text-x border-x/20` trio, so the two read as one
 * system without one importing the other. Colour is never the only channel: every state carries a
 * glyph and a word as well.
 */
const STANDING: Record<
  TenantUserStanding,
  {
    className: string;
    icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean | "true" | "false" }>;
  }
> = {
  ACTIVE: { className: "border-success/20 bg-success/10 text-success", icon: CheckCircle2 },
  DEACTIVATED: {
    className: "border-destructive/20 bg-destructive/10 text-destructive",
    icon: XCircle,
  },
  // Not a fault and not a healthy account. Warning rather than destructive, because it is the row
  // an operator should look at rather than one they should undo.
  NEVER_SIGNED_IN: {
    className: "border-warning/20 bg-warning/10 text-warning",
    icon: CircleDashed,
  },
  MUST_CHANGE: { className: "border-info/20 bg-info/10 text-info", icon: KeyRound },
};

export function UserStandingBadge({
  standing,
  className,
}: {
  standing: TenantUserStanding;
  className?: string;
}) {
  const descriptor = STANDING[standing];
  const Icon = descriptor.icon;
  return (
    <span
      data-testid={`user-standing-${standing}`}
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-label font-semibold whitespace-nowrap",
        descriptor.className,
        className,
      )}
    >
      <Icon className="size-3 shrink-0" aria-hidden="true" />
      {tenantUserStandingLabel(standing)}
    </span>
  );
}

/** The row-shaped convenience, so a grid cell does not re-derive the standing at every call site. */
export function UserRowStandingBadge({ user }: { user: TenantUserRow }) {
  return <UserStandingBadge standing={tenantUserStanding(user)} />;
}
