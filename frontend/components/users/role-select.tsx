"use client";

import { Info } from "lucide-react";

import { QueryErrorNotice } from "@/components/ui/query-boundary";
import { Skeleton } from "@/components/ui/skeleton";
import { useAssignableRoles } from "@/lib/hooks/use-users";

/**
 * The role picker, populated from `GET /api/v1/roles` and from nowhere else.
 *
 * <h3>Why there is no hardcoded role list in this file</h3>
 *
 * The endpoint returns only the roles the CALLER may assign: a role appears only if every
 * permission it grants is one the caller already holds (plan 13-07, derived from `role_permissions`
 * rather than enumerated). That is a privilege-escalation control. TENANT_ADMIN deliberately does
 * not hold `rbac.manage`, and an unfiltered picker would let it assign OWNER to an account it
 * controls and then sign in as one.
 *
 * <p>A constant array here would be a second, weaker copy of that rule living in the one place an
 * attacker can edit, and it would be wrong the day a role is added — the exact drift this repo has
 * hit five times over permission codes alone. So: no default, no fallback list, and no client-side
 * filtering of what the server returned.
 *
 * <h3>The withheld count</h3>
 *
 * When the ceiling removed something the envelope carries `ROLES_WITHHELD_ABOVE_CEILING`, a COUNT
 * and never a list of names. It is shown. Naming the roles would republish exactly what the ceiling
 * withholds; showing nothing turns "why is OWNER missing from my picker" into a support ticket.
 *
 * <h3>Failure</h3>
 *
 * A failed catalogue renders the error, not an empty `<select>`. An empty picker is the same lie as
 * an empty list screen: it says "you may assign no roles" when the truth is "we could not ask".
 */
export function RoleSelect({
  value,
  onChange,
  id,
  disabled,
  includeEmptyOption = true,
  emptyOptionLabel = "No role yet — assign later",
  describedById,
}: {
  value: string;
  onChange: (roleCode: string) => void;
  id: string;
  disabled?: boolean;
  includeEmptyOption?: boolean;
  emptyOptionLabel?: string;
  describedById?: string;
}) {
  const catalog = useAssignableRoles();

  if (catalog.isPending) {
    return <Skeleton className="h-8 w-full" />;
  }

  if (catalog.isError) {
    return (
      <QueryErrorNotice
        what="the roles you can assign"
        error={catalog.error}
        onRetry={() => void catalog.refetch()}
        isRetrying={catalog.isFetching}
      />
    );
  }

  const roles = catalog.data?.roles ?? [];
  const withheldCount = catalog.data?.withheldCount ?? 0;

  return (
    <div className="space-y-1.5">
      <select
        id={id}
        data-testid="role-select"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        aria-describedby={describedById}
        className="h-8 w-full rounded-lg border border-border-interactive bg-transparent px-2.5 text-small transition-colors focus-visible:border-ring disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-50 dark:bg-surface-2"
      >
        {includeEmptyOption && <option value="">{emptyOptionLabel}</option>}
        {roles.map((role) => (
          <option key={role.code} value={role.code}>
            {role.name}
          </option>
        ))}
      </select>

      {roles.length === 0 && (
        <p className="text-label text-warning-foreground">
          There are no roles you are allowed to assign. A role can only be granted by someone who
          already holds every permission it carries.
        </p>
      )}

      {withheldCount > 0 && (
        <p
          data-testid="roles-withheld"
          className="flex items-start gap-1.5 text-label text-muted-foreground"
        >
          <Info className="mt-0.5 size-3 shrink-0" aria-hidden="true" />
          <span>
            {withheldCount} more {withheldCount === 1 ? "role is" : "roles are"} not listed. A role
            can only be granted by someone who already holds every permission it carries.
          </span>
        </p>
      )}
    </div>
  );
}
