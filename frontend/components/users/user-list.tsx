"use client";

import { useState } from "react";
import { ShieldCheck, UserPlus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
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

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={term}
          onChange={(e) => changeSearch(e.target.value)}
          placeholder="Search by name or email…"
          aria-label="Search users"
          className="max-w-xs"
        />
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <input
            type="checkbox"
            checked={activeOnly}
            onChange={(e) => {
              setActiveOnly(e.target.checked);
              setPage(0);
            }}
            className="size-4 rounded border-border-interactive"
          />
          Active only
        </label>
        <div className="ml-auto flex items-center gap-2">
          {query.data && (
            <span className="text-sm text-muted-foreground tabular-nums">
              {total} {total === 1 ? "user" : "users"}
            </span>
          )}
          {canCreate && (
            <Button type="button" onClick={() => setCreateOpen(true)}>
              <UserPlus className="size-4" aria-hidden="true" />
              Add user
            </Button>
          )}
        </div>
      </div>

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
            {...(canCreate && !debounced
              ? { action: { label: "Add user", onClick: () => setCreateOpen(true) } }
              : {})}
          />
        }
      >
        <ul className="divide-y rounded-lg border" data-testid="user-list">
          {users.map((user) => (
            <li key={user.id}>
              <button
                type="button"
                onClick={() => onSelect(user)}
                aria-current={selectedId === user.id ? "true" : undefined}
                data-testid="user-row"
                className={cn(
                  "flex w-full items-center justify-between gap-4 px-4 py-3 text-left transition-colors hover:bg-muted/60",
                  selectedId === user.id && "bg-muted",
                )}
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium">{user.fullName ?? user.email}</span>
                  <span className="block truncate text-sm text-muted-foreground">{user.email}</span>
                </span>
                <span className="flex shrink-0 items-center gap-3">
                  {user.totpEnabled && (
                    <span
                      className="hidden items-center gap-1 text-xs text-muted-foreground sm:inline-flex"
                      title="Two-factor authentication is enrolled"
                    >
                      <ShieldCheck className="size-3.5" aria-hidden="true" />
                      2FA
                    </span>
                  )}
                  {user.mustChangePassword && (
                    <StatusBadge status="pending" label="Password reset pending" />
                  )}
                  <StatusBadge
                    status={user.active ? "active" : "inactive"}
                    label={user.active ? "Active" : "Deactivated"}
                  />
                  <span className="hidden w-32 text-right text-xs text-muted-foreground sm:block">
                    {formatLastLogin(user.lastLoginAt)}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </QueryBoundary>

      {(page > 0 || hasNextPage) && (
        <div className="flex items-center justify-between text-sm">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={page === 0 || query.isFetching}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
          >
            Previous
          </Button>
          <span className="text-muted-foreground tabular-nums">Page {page + 1}</span>
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
