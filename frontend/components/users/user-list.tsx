"use client";

import { useMemo, useState } from "react";
import { ShieldCheck, ShieldOff, UserPlus } from "lucide-react";

import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { DataGrid, type ColumnDef } from "@/components/ui/data-grid/data-grid";
import { EmptyState } from "@/components/ui/empty-state";
import { FilterBar } from "@/components/ui/filter-bar";
import { QueryBoundary } from "@/components/ui/query-boundary";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/ui/status-badge";
import { CreateUserDialog } from "@/components/users/user-form-dialog";
import { useDebouncedValue } from "@/lib/hooks/use-debounced-value";
import { useUsers } from "@/lib/hooks/use-users";
import { useCurrentUser } from "@/lib/hooks/auth/use-current-user";
import type { TenantUser } from "@/lib/models/user.model";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 25;

/** "Never" is a fact about the account, not a missing value — say it rather than showing a dash. */
function formatLastLogin(iso: string | null): string {
  if (!iso) return "Never signed in";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/**
 * The roster.
 *
 * <h3>Why the whole screen is wrapped in a QueryBoundary</h3>
 *
 * GA-001 — eleven of fifteen list screens rendered their EMPTY state when the request FAILED, so a
 * forced 500 and a forced `[]` produced byte-identical text. On this screen that failure mode has a
 * particular edge: "No users found" in a product whose user list is the tenant's staff roster reads
 * as "your restaurant has no staff", which is never true and is exactly the shape that produced the
 * "the app is empty" verdict. Error is checked before emptiness, always.
 *
 * <h3>Why search is server-side</h3>
 *
 * `GET /api/v1/users?search=` filters upstream against the whole tenant, and the page size is
 * capped at 200 there. Filtering the current page client-side would silently search one page and
 * report "nothing matches" for a user who is on page two.
 *
 * <h3>What the demo's `User Management` table asked for, and what this can honestly show</h3>
 *
 * The demo's admin screen (`:1285-1294`) has five columns: User / Role / Branch / Last Active /
 * 2FA. Four of those are real here. **Role and Branch are not**: `GET /api/v1/users` returns
 * `TenantUser`, which carries no role and no branch — those live on `TenantUserDetail`, one
 * request per user, and the panel beside this list is where they are shown. Adding the columns
 * would mean either N+1 requests to fill a list or a column of blanks, and a blank cell under a
 * heading reading "Role" is a claim that the person has none. They are left out, and this
 * paragraph is why. Last Active and 2FA — which the audit recorded as missing — are now here.
 */
export function UserList({
  selectedId,
  onSelect,
}: {
  selectedId: string | null;
  onSelect: (user: TenantUser) => void;
}) {
  const [term, setTerm] = useState("");
  const [activeOnly, setActiveOnly] = useState(false);
  const [page, setPage] = useState(0);
  const [createOpen, setCreateOpen] = useState(false);
  const debounced = useDebouncedValue(term, 250);
  const { permissions } = useCurrentUser();

  // Creating a user is gated on the same authority the endpoint enforces. Rendering the button for
  // someone the API will refuse is not a security hole, but it is a promise the product cannot keep.
  const canCreate = permissions.includes("rbac.manage") || permissions.includes("rbac.user.manage");

  const query = useUsers({
    page,
    size: PAGE_SIZE,
    search: debounced || undefined,
    activeOnly,
  });

  const users = query.data?.data ?? [];
  const total = query.data?.meta.totalCount ?? 0;
  const hasNextPage = query.data?.meta.page.nextCursor != null;

  function changeSearch(next: string) {
    setTerm(next);
    // A filtered result set is a different set: staying on page 3 of the old one shows an empty
    // page and looks like "no matches".
    setPage(0);
  }

  const columns = useMemo<ColumnDef<TenantUser, unknown>[]>(
    () => [
      {
        id: "user",
        accessorFn: (u) => u.fullName ?? u.email,
        header: "User",
        cell: ({ row }) => (
          <button
            type="button"
            onClick={() => onSelect(row.original)}
            aria-current={selectedId === row.original.id ? "true" : undefined}
            data-testid="user-row"
            className="flex items-center gap-(--space-sm) text-left"
          >
            {/* No `label`: the name is rendered right beside the disc, so a labelled avatar would
                have every row announced twice. */}
            <Avatar
              name={row.original.fullName ?? row.original.email}
              toneKey={row.original.id}
              size="sm"
            />
            <span className="min-w-0">
              <span className="block truncate font-medium underline-offset-2 hover:underline">
                {row.original.fullName ?? row.original.email}
              </span>
              <span className="block truncate text-small text-foreground-secondary">
                {row.original.email}
              </span>
            </span>
          </button>
        ),
      },
      {
        id: "status",
        header: "Status",
        enableSorting: false,
        cell: ({ row }) => (
          <span className="flex flex-wrap items-center gap-(--space-xs)">
            <StatusBadge
              status={row.original.active ? "active" : "inactive"}
              label={row.original.active ? "Active" : "Deactivated"}
            />
            {row.original.mustChangePassword && (
              <StatusBadge status="pending" label="Password reset pending" />
            )}
          </span>
        ),
      },
      {
        id: "totp",
        accessorKey: "totpEnabled",
        header: "2FA",
        // Icon AND word AND hue. An icon alone would make "enrolled" and "not enrolled" a
        // difference of shape at 14px, on a security column.
        cell: ({ row }) =>
          row.original.totpEnabled ? (
            <span className="inline-flex items-center gap-1 text-success">
              <ShieldCheck className="size-3.5 shrink-0" aria-hidden="true" />
              Enrolled
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-foreground-tertiary">
              <ShieldOff className="size-3.5 shrink-0" aria-hidden="true" />
              Not enrolled
            </span>
          ),
      },
      {
        id: "lastLoginAt",
        accessorKey: "lastLoginAt",
        header: "Last active",
        cell: ({ row }) => (
          <span className="text-foreground-secondary">
            {formatLastLogin(row.original.lastLoginAt)}
          </span>
        ),
      },
    ],
    [onSelect, selectedId],
  );

  return (
    <div className="space-y-(--space-md)">
      <FilterBar
        title="Roster"
        search={{
          value: term,
          onChange: changeSearch,
          label: "Search users by name or email",
          placeholder: "Search by name or email…",
        }}
        extraActiveCount={activeOnly ? 1 : 0}
        onClearAll={() => {
          changeSearch("");
          setActiveOnly(false);
        }}
        actions={
          <>
            {query.data && (
              <span className="text-small tabular-nums text-foreground-secondary">
                {total} {total === 1 ? "user" : "users"}
              </span>
            )}
            {canCreate && (
              <Button type="button" onClick={() => setCreateOpen(true)}>
                <UserPlus className="size-4" aria-hidden="true" />
                Add user
              </Button>
            )}
          </>
        }
      >
        <label className="flex items-center gap-2 text-small text-foreground-secondary">
          <input
            type="checkbox"
            checked={activeOnly}
            onChange={(e) => {
              setActiveOnly(e.target.checked);
              setPage(0);
            }}
            className="size-4 rounded-sm border-border-interactive"
          />
          Active only
        </label>
      </FilterBar>

      <QueryBoundary
        query={query}
        what="the user list"
        isEmpty={users.length === 0}
        loading={
          <div className="space-y-2">
            {[0, 1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-14 w-full" />
            ))}
          </div>
        }
        empty={
          <EmptyState
            title={debounced ? "No users match that search" : "No users yet"}
            description={
              debounced
                ? `Nothing matches "${debounced}". Clear the search to see everyone.`
                : "Add the people who work here so they can sign in."
            }
            /* Filtered-empty offers the way OUT of the filter; truly-empty offers the create
               CTA, and only to someone who may create (UI-SPEC §8.3). Never both, never the
               wrong one: inviting a manager to "Add user" because their search found nobody is
               how a duplicate account gets made. */
            {...(debounced || activeOnly
              ? {
                  action: {
                    label: "Clear all",
                    onClick: () => {
                      changeSearch("");
                      setActiveOnly(false);
                    },
                  },
                }
              : canCreate
                ? { action: { label: "Add user", onClick: () => setCreateOpen(true) } }
                : {})}
          />
        }
      >
        <div data-testid="user-list">
          <DataGrid
            label="Users"
            columns={columns}
            data={users}
            pageSize={PAGE_SIZE}
            isFiltered={debounced.length > 0 || activeOnly}
            onClearFilters={() => {
              changeSearch("");
              setActiveOnly(false);
            }}
            rowClassName={(u) => cn(selectedId === u.id && "bg-selected")}
            emptyTitle={debounced ? "No users match that search" : "No users yet"}
            card={{
              primary: (u) => u.fullName ?? u.email,
              secondary: (u) => u.email,
              trailing: (u) => (
                <StatusBadge
                  status={u.active ? "active" : "inactive"}
                  label={u.active ? "Active" : "Deactivated"}
                />
              ),
            }}
          />
        </div>
      </QueryBoundary>

      {(page > 0 || hasNextPage) && (
        <div className="flex items-center justify-between text-small">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={page === 0 || query.isFetching}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
          >
            Previous
          </Button>
          <span className="tabular-nums text-foreground-secondary">Page {page + 1}</span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!hasNextPage || query.isFetching}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </Button>
        </div>
      )}

      <CreateUserDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  );
}
