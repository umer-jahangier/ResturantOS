"use client";

import { useMemo, useState } from "react";
import { Lock, Search } from "lucide-react";

import type { PermissionModule } from "@/lib/models/role.model";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * The permission catalogue as a picker, and — with `readOnly` — as the answer to "what does this
 * role actually grant?"
 *
 * <p>One component for both because they are the same question asked twice. The register's finding
 * was not only that a role could not be built: it was that <b>nowhere in the product could anyone
 * see what a role grants</b>. A separate read-only viewer would be a second place for that answer
 * to be rendered, and the two would drift the first time a module was added.
 *
 * <h3>Grouping is the server's</h3>
 *
 * <p>`GET /api/v1/permissions` returns modules in order with codes sorted inside them. Nothing here
 * re-sorts. A client that re-derived the grouping would have to split codes on a dot, which breaks
 * the day a module name contains one.
 *
 * <h3>The ceiling is shown, never enforced here</h3>
 *
 * <p>A permission the caller does not hold is marked and warned about, and is still tickable. That
 * is deliberate and it is not laziness:
 *
 * <ul>
 *   <li>The authority is the SERVER's. It recomputes the caller's permissions from
 *       `user_branch_roles` at the moment of the write and refuses with 403
 *       `ROLE_CEILING_EXCEEDED`. A checkbox that cannot be ticked would be a second, weaker copy of
 *       that rule living in the one place an attacker controls.</li>
 *   <li>The browser's view of the ceiling is a TOKEN, and a token is a snapshot. A role granted to
 *       this admin a minute ago is not in a token minted before it. Blocking on a stale snapshot
 *       would refuse a write the server would have accepted, with no way for the user to tell why.
 *   </li>
 * </ul>
 *
 * <p>So the marker teaches, the inline warning predicts, and the refusal — when it comes — is the
 * server's own sentence.
 */
export interface PermissionPickerProps {
  modules: PermissionModule[];
  /** The codes currently ticked. */
  selected: string[];
  onChange?: (next: string[]) => void;
  /** Codes the CALLER holds. Anything outside this set is marked as beyond their authority. */
  callerPermissions?: string[];
  /** Read-only: no checkboxes, only the modules a role grants. Used to inspect a built-in role. */
  readOnly?: boolean;
  /** Read-only mode shows only the granted codes by default; pass true to show the whole vocabulary. */
  showUngranted?: boolean;
  idPrefix?: string;
}

export function PermissionPicker({
  modules,
  selected,
  onChange,
  callerPermissions,
  readOnly = false,
  showUngranted = false,
  idPrefix = "perm",
}: PermissionPickerProps) {
  const [search, setSearch] = useState("");
  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const heldSet = useMemo(
    () => (callerPermissions ? new Set(callerPermissions) : null),
    [callerPermissions],
  );

  const query = search.trim().toLowerCase();
  const visibleModules = useMemo(() => {
    return modules
      .map((module) => ({
        module: module.module,
        permissions: module.permissions.filter((permission) => {
          if (readOnly && !showUngranted && !selectedSet.has(permission.code)) return false;
          if (!query) return true;
          return (
            permission.code.toLowerCase().includes(query) ||
            module.module.toLowerCase().includes(query) ||
            (permission.description ?? "").toLowerCase().includes(query)
          );
        }),
      }))
      .filter((group) => group.permissions.length > 0);
  }, [modules, query, readOnly, showUngranted, selectedSet]);

  function toggle(code: string) {
    if (!onChange) return;
    onChange(
      selectedSet.has(code) ? selected.filter((c) => c !== code) : [...selected, code].sort(),
    );
  }

  function toggleModule(codes: string[], allOn: boolean) {
    if (!onChange) return;
    const next = allOn
      ? selected.filter((code) => !codes.includes(code))
      : Array.from(new Set([...selected, ...codes])).sort();
    onChange(next);
  }

  const totalVisible = visibleModules.reduce((sum, g) => sum + g.permissions.length, 0);

  return (
    <div className="flex flex-col gap-3">
      <div className="relative">
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Filter permissions — try “order”, “finance”, “void”"
          aria-label="Filter permissions"
          className="pl-9"
        />
      </div>

      {totalVisible === 0 ? (
        <p
          role="status"
          className="rounded-md border border-dashed px-4 py-8 text-center text-body text-muted-foreground"
        >
          {query
            ? `Nothing in the catalogue matches “${search.trim()}”.`
            : "This role grants no permissions."}
        </p>
      ) : (
        <div className="max-h-[46dvh] space-y-4 overflow-y-auto pr-1">
          {visibleModules.map((group) => {
            const codes = group.permissions.map((p) => p.code);
            const chosen = codes.filter((code) => selectedSet.has(code)).length;
            const allOn = chosen === codes.length && codes.length > 0;
            return (
              <section key={group.module} aria-labelledby={`${idPrefix}-${group.module}`}>
                <div className="flex items-center justify-between gap-3 border-b pb-1">
                  <h3
                    id={`${idPrefix}-${group.module}`}
                    className="text-body font-semibold uppercase tracking-[0.08em] text-foreground"
                  >
                    {group.module}
                  </h3>
                  {readOnly ? (
                    <span className="text-small text-muted-foreground">{chosen} granted</span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => toggleModule(codes, allOn)}
                      className="text-small font-medium text-primary underline-offset-2 hover:underline"
                    >
                      {allOn ? "Clear module" : "Select all"} ({chosen}/{codes.length})
                    </button>
                  )}
                </div>

                <ul className="mt-2 space-y-1">
                  {group.permissions.map((permission) => {
                    const isSelected = selectedSet.has(permission.code);
                    const beyondCeiling = heldSet !== null && !heldSet.has(permission.code);
                    const inputId = `${idPrefix}-${permission.code}`;
                    return (
                      <li key={permission.code}>
                        <label
                          htmlFor={inputId}
                          className={cn(
                            "flex items-start gap-3 rounded-md px-2 py-1.5",
                            !readOnly && "cursor-pointer hover:bg-surface-2",
                          )}
                        >
                          {readOnly ? (
                            <span
                              aria-hidden="true"
                              className="mt-1 size-2 shrink-0 rounded-full bg-primary-solid"
                            />
                          ) : (
                            <input
                              id={inputId}
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => toggle(permission.code)}
                              className="mt-0.5 size-4 shrink-0 rounded-sm border-input"
                              aria-describedby={`${inputId}-desc`}
                            />
                          )}
                          <span className="min-w-0 flex-1">
                            <span className="flex flex-wrap items-center gap-2">
                              <code className="font-mono text-small text-foreground">
                                {permission.code}
                              </code>
                              {beyondCeiling && (
                                <span className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-medium text-foreground-tertiary">
                                  <Lock aria-hidden="true" className="size-3" />
                                  You don&rsquo;t hold this
                                </span>
                              )}
                            </span>
                            <span
                              id={`${inputId}-desc`}
                              className="block text-small text-muted-foreground"
                            >
                              {permission.description ?? "No description recorded for this code."}
                            </span>
                          </span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
