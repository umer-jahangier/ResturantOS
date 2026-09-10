"use client";

import * as React from "react";
import Link from "next/link";
import { AlertTriangle, ShieldCheck, ShieldOff } from "lucide-react";

import { Avatar } from "@/components/ui/avatar";
import { ConsoleFact, ConsoleNote, ConsoleSection } from "@/components/platform/console-section";
import { UserStandingBadge } from "@/components/platform/user-standing-badge";
import { formatDateTime } from "@/lib/format/locale";
import { ELAPSED_ABSOLUTE_BOUND_MS, readElapsed } from "@/lib/format/elapsed";
import { useWallClock } from "@/lib/hooks/ui/use-wall-clock";
import { tenantUserStanding } from "@/lib/models/platform.model";
import type { PlatformUserDetail } from "@/lib/models/platform-access.model";

/**
 * Who this person is, which restaurant they belong to, and whether the account works.
 *
 * <h3>The one question this panel exists to answer</h3>
 *
 * Not "what are their details" — a console can print those from any row. It is *"can this account
 * be used right now, and if not, why not"*. The API computes that as `loginable` with a
 * `loginableNote`, and it is computed there rather than here because the three reasons it can be
 * false are not all visible in the fields beside it: a deactivated flag, an empty set of branch
 * roles (permission resolution fails before a token is minted, so the account looks created and is
 * unusable), or a tenant that is not ACTIVE — in which case the account is fine and the restaurant
 * is not, which sends an operator looking in a completely different place.
 *
 * <h3>Activity is one timestamp, and the panel says so</h3>
 *
 * `last_login_at` is the ONLY activity signal this platform records about a person. There is no
 * session count, no last-seen and no per-user action counter anywhere in the product, and
 * attempt-level login history lives in `audit_db.audit_events`, which the platform plane cannot
 * read — separate database, FORCE row-level security on every partition, no platform-tier read
 * endpoint. So a richer "last active" reading would be invented. What the one timestamp CAN say
 * matters: null means the account has never been used, which is the visible form of a restaurant
 * whose administrator cannot get in.
 */
export function UserIdentityPanel({ user }: { user: PlatformUserDetail }) {
  const standing = tenantUserStanding({
    tenantId: user.tenant.tenantId,
    tenantSlug: user.tenant.slug,
    tenantBrandName: user.tenant.brandName,
    userId: user.userId,
    email: user.email,
    fullName: user.fullName,
    locale: user.locale,
    active: user.active,
    mustChangePassword: user.mustChangePassword,
    totpEnabled: user.totpEnabled,
    lastLoginAt: user.activity.lastLoginAt,
    createdAt: user.createdAt,
  });

  const lastLogin = user.activity.lastLoginAt;
  /*
    The clock is read once at mount through `useWallClock` rather than in the render body.
    `Date.now()` during render is impure — the same component renders a different string on every
    pass — and a relative label is not the thing being watched on this screen anyway: it is correct
    when the reader looks at it, and a refetch or a navigation re-mounts it.
  */
  const now = useWallClock();
  /*
    The relative reading is only appended while it IS relative. `readElapsed` switches its `long`
    face to an absolute date past 30 days, and "7 August 2026 ago" is the kind of sentence a
    console prints once and nobody trusts it again afterwards. Past the bound the absolute stamp
    beside it already says everything.
  */
  const elapsed = lastLogin ? readElapsed(lastLogin, now) : null;
  const relative =
    elapsed && elapsed.ageMs !== null && elapsed.ageMs < ELAPSED_ABSOLUTE_BOUND_MS
      ? elapsed.long
      : null;

  return (
    <ConsoleSection
      anchorId="identity"
      eyebrow="Person"
      title="Who this is"
      description="The account, the restaurant it belongs to, and whether it can currently be signed in to."
      data-testid="user-identity"
    >
      <div className="flex flex-col gap-(--space-md)">
        <div className="flex flex-wrap items-center gap-(--space-md)">
          <Avatar
            name={user.fullName ?? user.email}
            toneKey={user.userId}
            size="lg"
            label={`Avatar for ${user.fullName ?? user.email}`}
          />
          <div className="min-w-0">
            <p className="truncate font-heading text-h2 leading-snug font-medium">
              {user.fullName ?? <span className="text-foreground-tertiary">No name recorded</span>}
            </p>
            <p className="truncate font-mono text-small text-foreground-secondary">{user.email}</p>
          </div>
          <UserStandingBadge standing={standing} className="ms-auto" />
        </div>

        {/*
          The account's usability, stated in the API's own words. It is rendered as a note rather
          than a chip because the reason is the part an operator acts on — "holds no active
          branch-role assignment" and "its tenant is SUSPENDED" send them to two different screens.
        */}
        {user.loginable ? (
          <ConsoleNote data-testid="user-loginable">
            This account can be signed in to: it is active, it holds at least one branch-role
            assignment, and its tenant is serving.
          </ConsoleNote>
        ) : (
          <ConsoleNote tone="warning" role="alert" data-testid="user-not-loginable">
            <span className="inline-flex items-center gap-2 font-semibold">
              <AlertTriangle className="size-4 shrink-0" aria-hidden="true" />
              This account cannot be used.
            </span>{" "}
            {user.loginableNote ??
              "The platform could not determine why, which is itself worth investigating."}
          </ConsoleNote>
        )}

        <dl className="grid grid-cols-1 gap-(--space-md) md:grid-cols-2 xl:grid-cols-3">
          <ConsoleFact
            label="Tenant"
            value={
              <Link
                href={`/platform/tenants/${user.tenant.tenantId}`}
                className="hover:text-primary"
              >
                {user.tenant.brandName ?? user.tenant.slug ?? user.tenant.tenantId}
              </Link>
            }
          />
          <ConsoleFact label="Tenant slug" value={user.tenant.slug} absence="No slug" mono />
          <ConsoleFact label="Tenant state" value={user.tenant.status} absence="Not recorded" />
          <ConsoleFact label="Tier" value={user.tenant.tier} absence="No tier recorded" />
          <ConsoleFact
            label="Two-factor"
            value={
              user.totpEnabled ? (
                <span className="inline-flex items-center gap-1 text-success">
                  <ShieldCheck className="size-3.5 shrink-0" aria-hidden="true" />
                  Enrolled
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-foreground-tertiary">
                  <ShieldOff className="size-3.5 shrink-0" aria-hidden="true" />
                  Not enrolled
                </span>
              )
            }
          />
          <ConsoleFact
            label="Password"
            value={user.mustChangePassword ? "Change required at next sign-in" : "Set by the user"}
          />
          <ConsoleFact label="Locale" value={user.locale} absence="Not set" mono />
          <ConsoleFact label="Account created" value={formatDateTime(user.createdAt)} />
          <ConsoleFact label="User id" value={user.userId} mono />
        </dl>

        <div className="flex flex-col gap-2 border-t pt-(--space-md)">
          <p className="text-label font-semibold tracking-eyebrow text-foreground-tertiary uppercase">
            Activity
          </p>
          {user.activity.hasEverSignedIn && lastLogin ? (
            <p className="text-small" data-testid="user-last-sign-in">
              Last signed in <span className="font-medium">{formatDateTime(lastLogin)}</span>
              {relative ? (
                <span className="text-foreground-secondary"> — {relative} ago</span>
              ) : null}
              .
            </p>
          ) : (
            <p className="text-small text-warning" data-testid="user-never-signed-in">
              <span className="font-semibold">Has never signed in.</span> The account was
              provisioned and has not been used once — which is a state, not a missing date, and on
              a first administrator it is the shape of a restaurant that cannot get in.
            </p>
          )}
          {/*
            The standing caveat travels from the API rather than being paraphrased here, so that a
            change in what the platform can see changes what the console claims without a frontend
            release.
          */}
          <p className="text-label text-muted-foreground">{user.activity.note}</p>
        </div>
      </div>
    </ConsoleSection>
  );
}
