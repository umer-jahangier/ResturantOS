import type { Metadata } from "next";

import { AppearanceForm } from "@/components/settings/appearance-form";

export const metadata: Metadata = {
  title: "Appearance | Settings",
  description: "Customize your restaurant's branding.",
};

/**
 * Settings → Appearance page.
 *
 * Server-component wrapper: renders the title/description shell and delegates
 * all interactive state to the <AppearanceForm> client component.
 *
 * Route: /(tenant)/settings/appearance
 * Protected by the (tenant) layout auth guard — no additional guard needed here.
 *
 * Persistence: `AppearanceForm` writes `tenant-theme-settings` to localStorage and nothing else.
 * The "Phase 7 backend contract" this comment used to promise —
 * `PUT /api/v1/tenants/:id/theme` — does not exist: measured as TENANT_ADMIN through the real
 * gateway on 2026-08-11, that path answers 404, as do `/api/v1/tenant-profile`,
 * `/api/v1/tenants/{id}/settings` and `/api/v1/settings`.
 *
 * The page copy used to say changes "will be applied when you reload", which was half true in the
 * worst possible way: the colour WAS re-applied by the layout's theme injector, while the form
 * itself came back showing the default — so the app was green and the form said blue. Both halves
 * are fixed: the form reads back what it wrote, and the wording now says where the setting lives.
 */
export default function AppearancePage() {
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Appearance</h1>
        <p className="text-sm text-muted-foreground">
          Choose the colour this app uses on your screen. It is remembered in this browser — it is
          not part of your restaurant&apos;s settings and other people will not see it.
        </p>
      </div>

      <hr className="border-border" />

      <AppearanceForm />
    </div>
  );
}
