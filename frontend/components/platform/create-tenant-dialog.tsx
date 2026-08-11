"use client";

import * as React from "react";
import { Copy, KeyRound } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatUserFacingError } from "@/lib/errors";
import { useCreateTenant } from "@/lib/hooks/use-platform-tenants";
import type { ProvisionResult, TenantTier } from "@/lib/models/platform.model";

const TIERS: TenantTier[] = ["STARTER", "GROWTH", "ENTERPRISE", "CUSTOM"];

/**
 * Provision a tenant, and show the one-time password exactly once.
 *
 * <h3>The credential has nowhere else to go</h3>
 *
 * `POST /tenants` returns a `tempPassword` and, as the audit records, there is **no delivery
 * channel**: notification-service has no source files, so no email is ever sent. Before this
 * screen existed the credential was returned to a `curl` and, if the operator did not notice it,
 * the new tenant's admin could never log in — the account existed and was unreachable.
 *
 * So this dialog does not close on success. It switches to a result panel that states plainly that
 * the password will not be shown again, offers a copy control, and requires an explicit dismissal.
 * Auto-closing on a successful mutation would be the conventional behaviour and would throw away
 * the only copy of a credential.
 *
 * The password is rendered in a monospace face at full contrast rather than masked: masking
 * protects a secret the viewer already knows, and here the viewer is the only person who will ever
 * see it and must transcribe it accurately.
 */
export function CreateTenantDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/*
        Mounted only while open, so every field — and, more importantly, the one-time password in
        `result` — is discarded by unmounting rather than cleared by an effect. A credential that
        lives in component state after the dialog closes is a credential still in memory for the
        rest of the session with nothing on screen to indicate it.
      */}
      {open && <CreateTenantBody onOpenChange={onOpenChange} />}
    </Dialog>
  );
}

function CreateTenantBody({ onOpenChange }: { onOpenChange: (open: boolean) => void }) {
  const create = useCreateTenant();
  const [brandName, setBrandName] = React.useState("");
  const [adminEmail, setAdminEmail] = React.useState("");
  const [tier, setTier] = React.useState<TenantTier>("STARTER");
  const [result, setResult] = React.useState<ProvisionResult | null>(null);

  const canSubmit =
    brandName.trim().length > 0 && adminEmail.trim().length > 0 && !create.isPending;

  return (
    <>
      <DialogContent data-testid="create-tenant-dialog">
        {result ? (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <KeyRound className="size-4 text-warning" aria-hidden="true" />
                {result.slug} provisioned
              </DialogTitle>
              <DialogDescription>
                This password is shown once and is not stored anywhere you can read it again. There
                is no email delivery — you must pass it to the tenant administrator yourself.
              </DialogDescription>
            </DialogHeader>

            <dl className="space-y-3 text-sm">
              <div>
                <dt className="text-muted-foreground">Administrator</dt>
                <dd className="font-medium">{result.adminEmail}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Temporary password</dt>
                <dd className="flex items-center gap-2">
                  {result.tempPassword ? (
                    <>
                      <code
                        className="rounded-md border bg-muted px-2 py-1 font-mono text-sm"
                        data-testid="temp-password"
                      >
                        {result.tempPassword}
                      </code>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Copy password"
                        onClick={() => {
                          void navigator.clipboard?.writeText(result.tempPassword ?? "");
                        }}
                      >
                        <Copy className="size-3.5" aria-hidden="true" />
                      </Button>
                    </>
                  ) : (
                    <span className="text-muted-foreground">
                      No longer available — this was a repeated request and the credential&apos;s
                      retention window has passed. Reset it from the tenant&apos;s users screen.
                    </span>
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Sign-in URL</dt>
                <dd className="font-mono text-xs break-all">{result.loginUrl}</dd>
              </div>
            </dl>

            <DialogFooter>
              <Button onClick={() => onOpenChange(false)}>I have saved the password</Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Create tenant</DialogTitle>
              <DialogDescription>
                Provisions the tenant, its HQ branch, its chart of accounts and its first
                administrator. If any step fails the whole thing is rolled back.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="brand-name">Brand name</Label>
                <Input
                  id="brand-name"
                  value={brandName}
                  data-testid="create-tenant-brand"
                  onChange={(e) => setBrandName(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  The slug is derived from this and cannot be changed later — login resolves tenants
                  by it.
                </p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="admin-email">Administrator email</Label>
                <Input
                  id="admin-email"
                  type="email"
                  value={adminEmail}
                  data-testid="create-tenant-email"
                  onChange={(e) => setAdminEmail(e.target.value)}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="tier">Tier</Label>
                <select
                  id="tier"
                  value={tier}
                  data-testid="create-tenant-tier"
                  onChange={(e) => setTier(e.target.value as TenantTier)}
                  className="h-8 w-full rounded-lg border border-border bg-background px-2.5 text-sm"
                >
                  {TIERS.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>

              {create.isError && (
                <div
                  role="alert"
                  className="rounded-md border border-destructive/30 bg-destructive/15 p-3 text-sm text-destructive"
                >
                  {formatUserFacingError(create.error)}
                </div>
              )}
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button
                disabled={!canSubmit}
                data-testid="create-tenant-submit"
                onClick={() =>
                  create.mutate(
                    { brandName: brandName.trim(), adminEmail: adminEmail.trim(), tier },
                    { onSuccess: setResult },
                  )
                }
              >
                {create.isPending ? "Provisioning…" : "Create tenant"}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </>
  );
}
