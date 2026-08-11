"use client";

import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import { toast } from "sonner";

import { createZodResolver } from "@/lib/forms/zod-resolver";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { QueryErrorNotice } from "@/components/ui/query-boundary";
import { RoleSelect } from "@/components/users/role-select";
import { OneTimePasswordPanel } from "@/components/users/one-time-password-panel";
import { StationAssignmentField } from "@/components/users/station-assignment-field";
import {
  useCreateUser,
  useReplaceUserStations,
  useUpdateUser,
  useUserStations,
} from "@/lib/hooks/use-users";
import { useTenantBranches } from "@/lib/hooks/use-tenant-settings";
import { useCurrentUser } from "@/lib/hooks/auth/use-current-user";
import { branchStationScope } from "@/lib/models/user.model";
import { formatUserFacingError } from "@/lib/errors";
import type { OneTimePassword, TenantUser } from "@/lib/models/user.model";

/**
 * Create and edit, in one dialog because they are the same four fields — minus the two the API
 * refuses to let an edit touch.
 *
 * <h3>Two fields that are absent on purpose</h3>
 *
 * <ul>
 *   <li><b>No password field, on either mode.</b> Create MINTS a temporary password and returns it
 *       once; `PATCH /api/v1/users/{id}` REFUSES a body carrying `password`, `newPassword`,
 *       `passwordHash` or `temp_password` with a 400 and stores nothing (13-12 §4). A password
 *       input here could only ever produce a validation error, and would teach an admin that
 *       setting someone's password is a thing this form does.</li>
 *   <li><b>No tenant field.</b> Scope comes from the verified JWT. The request DTO has nowhere to
 *       put one, and the absence is the enforcement.</li>
 * </ul>
 *
 * <h3>The branch/role pairing</h3>
 *
 * `branchId` and `roleCode` travel together — one without the other is a 400 that creates nothing.
 * The form enforces the pairing itself so a refusal is never how an admin learns it, and both
 * absent is offered explicitly as "create the account, assign later", because that is a legal and
 * sometimes correct thing to do. When it is chosen, the result panel says the account cannot sign
 * in yet, rather than leaving it to be discovered at that user's first attempt.
 */

const createSchema = z
  .object({
    email: z.string().min(1, "Email address is required").email("Enter a valid email address"),
    fullName: z.string(),
    branchId: z.string(),
    roleCode: z.string(),
  })
  .refine((v) => (v.branchId === "") === (v.roleCode === ""), {
    message: "Choose both a branch and a role, or neither",
    path: ["roleCode"],
  });

const editSchema = z.object({
  fullName: z.string(),
});

/** Stable identity so `pendingCodes ?? serverCodes` does not change reference every render. */
const EMPTY_CODES: string[] = [];

type CreateValues = z.infer<typeof createSchema>;
type EditValues = z.infer<typeof editSchema>;

export function CreateUserDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const create = useCreateUser();
  const replaceStations = useReplaceUserStations();
  const branches = useTenantBranches(open);
  const [result, setResult] = useState<OneTimePassword | null>(null);
  const [stationCodes, setStationCodes] = useState<string[]>([]);

  const form = useForm<CreateValues>({
    resolver: createZodResolver(createSchema),
    defaultValues: { email: "", fullName: "", branchId: "", roleCode: "" },
  });

  // `useWatch`, not `form.watch()`: the latter returns a function the React Compiler cannot
  // memoize, which makes it skip compiling this whole component.
  const branchId = useWatch({ control: form.control, name: "branchId" }) ?? "";

  function close() {
    onOpenChange(false);
    // Reset only once the dialog is closed, so the credential is not wiped from under an admin
    // who is mid-copy when a background refetch re-renders this tree.
    setResult(null);
    form.reset();
    setStationCodes([]);
    create.reset();
  }

  function onSubmit(values: CreateValues) {
    create.mutate(
      {
        email: values.email.trim(),
        fullName: values.fullName.trim() || undefined,
        branchId: values.branchId || undefined,
        roleCode: values.roleCode || undefined,
      },
      {
        onSuccess: (created) => {
          setResult(created);
          // Two calls because there are two endpoints: `POST /api/v1/users` has no station field
          // and 28-01 deliberately did not add one — the assignment is gated on
          // `rbac.role.manage` and lives on its own PUT. Skipped entirely when nothing was
          // chosen: unrestricted is the do-nothing default all the way to the wire, so an empty
          // replace would be a write nobody asked for.
          if (values.branchId && stationCodes.length > 0) {
            replaceStations.mutate(
              { userId: created.userId, payload: { branchId: values.branchId, stationCodes } },
              {
                // The account exists either way. Saying which half failed is the difference
                // between an admin re-running the whole thing and an admin editing the account.
                onError: (error) =>
                  toast.error(
                    `The account was created, but its stations were not saved: ${formatUserFacingError(error)}`,
                  ),
              },
            );
          }
        },
        onError: (error) => toast.error(formatUserFacingError(error)),
      },
    );
  }

  const branchLabel = branches.data?.find((b) => b.id === branchId)?.name ?? "that branch";

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{result ? "Account created" : "Add a user"}</DialogTitle>
          <DialogDescription>
            {result
              ? "Hand over the temporary password below. It is shown once."
              : "They will sign in with their email address and a temporary password issued here."}
          </DialogDescription>
        </DialogHeader>

        {result ? (
          <>
            <OneTimePasswordPanel result={result} intro="The account is ready." />
            <DialogFooter>
              <Button type="button" onClick={close}>
                Done
              </Button>
            </DialogFooter>
          </>
        ) : (
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email address</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        type="email"
                        autoComplete="off"
                        placeholder="name@restaurant.local"
                      />
                    </FormControl>
                    <FormDescription>This is what they sign in with.</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="fullName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Full name</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="Optional" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="grid gap-4 sm:grid-cols-2">
                <FormField
                  control={form.control}
                  name="branchId"
                  render={({ field }) => (
                    <FormItem>
                      {/* `htmlFor` is explicit because the select below carries a hardcoded id
                          that overrides the one `FormControl` would have generated — so the
                          label pointed at nothing and the field had no accessible name. Same
                          fix, same reason, as the Role label directly beside it. */}
                      <FormLabel htmlFor="create-user-branch">Branch</FormLabel>
                      {branches.isError ? (
                        <QueryErrorNotice
                          what="your branches"
                          error={branches.error}
                          onRetry={() => void branches.refetch()}
                          isRetrying={branches.isFetching}
                        />
                      ) : (
                        <FormControl>
                          <select
                            {...field}
                            // A station CODE is unique within a BRANCH, not within a tenant, and
                            // auth-service deliberately does not validate codes against
                            // pos-service — it has no route into pos_db and says so. A code
                            // carried across a branch change would therefore be ACCEPTED, and
                            // would filter the user to a station that produces no tickets: a
                            // screen that simply never lights up, with nothing in any log. The
                            // selection is dropped here, at the moment the branch moves, rather
                            // than reconciled afterwards.
                            onChange={(e) => {
                              field.onChange(e);
                              setStationCodes([]);
                            }}
                            id="create-user-branch"
                            disabled={branches.isPending}
                            className="h-8 w-full rounded-lg border border-border-interactive bg-transparent px-2.5 text-sm transition-colors focus-visible:border-ring disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-50 dark:bg-surface-2"
                          >
                            <option value="">No branch yet</option>
                            {(branches.data ?? []).map((branch) => (
                              <option key={branch.id} value={branch.id}>
                                {branch.name}
                                {branch.isHq ? " (HQ)" : ""}
                              </option>
                            ))}
                          </select>
                        </FormControl>
                      )}
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="roleCode"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel htmlFor="create-user-role">Role</FormLabel>
                      <RoleSelect
                        id="create-user-role"
                        value={field.value}
                        onChange={field.onChange}
                      />
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              {/* Below the role, not beside it: D-28-02 puts the station in "the same form as
                  role assignment", and the three decisions about where a person works read as one
                  group. Gated on a branch having been chosen — a station code only resolves
                  within a branch, so offering the picker first invites an assignment that cannot
                  be interpreted. */}
              {branchId ? (
                <div className="space-y-1.5">
                  <p className="text-sm font-medium">Stations</p>
                  <StationAssignmentField
                    branchId={branchId}
                    branchLabel={branchLabel}
                    value={stationCodes}
                    onChange={setStationCodes}
                  />
                </div>
              ) : null}

              <p className="text-xs text-muted-foreground">
                Leave both blank to create the account now and assign a role later. Until a role is
                assigned the account exists but cannot sign in.
              </p>

              <DialogFooter>
                <Button type="button" variant="outline" onClick={close}>
                  Cancel
                </Button>
                <Button type="submit" disabled={create.isPending}>
                  {create.isPending ? "Creating…" : "Create user"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function EditUserDialog({
  user,
  open,
  onOpenChange,
}: {
  user: TenantUser | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const update = useUpdateUser();
  const replaceStations = useReplaceUserStations();
  const { branchId: signedInBranchId } = useCurrentUser();
  const branches = useTenantBranches(open);
  const scope = useUserStations(open && user ? user.id : null);

  const form = useForm<EditValues>({
    resolver: createZodResolver(editSchema),
    values: { fullName: user?.fullName ?? "" },
  });

  // The edited selection is held as `null` until the admin touches it, and READ THROUGH to the
  // server's answer until then. Seeding state from a query inside an effect would flash an empty
  // picker on the first render and — worse — an editor that opened empty and was then saved would
  // clear an assignment nobody looked at, which is a silent widening of scope.
  const [pendingCodes, setPendingCodes] = useState<string[] | null>(null);
  const loadedAtBranch = branchStationScope(scope.data, signedInBranchId);
  const serverCodes = loadedAtBranch.unrestricted ? EMPTY_CODES : loadedAtBranch.stationCodes;
  const stationCodes = pendingCodes ?? serverCodes;
  const stationsTouched = pendingCodes !== null;

  if (!user) return null;

  const branchLabel =
    branches.data?.find((b) => b.id === signedInBranchId)?.name ?? "this branch";

  function onSubmit(values: EditValues) {
    if (!user) return;
    update.mutate(
      { userId: user.id, payload: { fullName: values.fullName.trim() } },
      {
        onSuccess: () => {
          // Only written when the admin actually changed the selection. A profile edit that
          // silently re-wrote a station scope would be a second write path nobody asked for, and
          // this dialog can only ever see ONE branch's stations (see the field's javadoc) — so
          // an unconditional write would be an unconditional write of a partial view.
          if (!stationsTouched) {
            toast.success("Profile updated");
            onOpenChange(false);
            return;
          }
          replaceStations.mutate(
            { userId: user.id, payload: { branchId: signedInBranchId, stationCodes } },
            {
              onSuccess: () => {
                toast.success("Profile and stations updated");
                onOpenChange(false);
              },
              onError: (error) =>
                toast.error(
                  `The name was saved, but the stations were not: ${formatUserFacingError(error)}`,
                ),
            },
          );
        },
        onError: (error) => toast.error(formatUserFacingError(error)),
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit {user.email}</DialogTitle>
          <DialogDescription>
            The email address is the account&apos;s identity and cannot be changed here. To give
            this user a new password, use Reset password.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="fullName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Full name</FormLabel>
                  <FormControl>
                    <Input {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="space-y-1.5">
              <p className="text-sm font-medium">Stations at {branchLabel}</p>
              <StationAssignmentField
                branchId={signedInBranchId}
                branchLabel={branchLabel}
                value={stationCodes}
                onChange={setPendingCodes}
              />
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={update.isPending || replaceStations.isPending}>
                {update.isPending || replaceStations.isPending ? "Saving…" : "Save changes"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
