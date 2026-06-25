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
 * Persistence: AppearanceForm saves to localStorage under key
 * "tenant-theme-settings". Phase 7 replaces this with:
 *   PUT /api/v1/tenants/:id/theme { brandColor: string, logoUrl: string | null }
 *
 * Navigation: this page exists at the correct route for sidebar nav integration.
 * The sidebar nav-items entry is added by plan 04-07 — not this plan.
 */
export default function AppearancePage() {
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Appearance</h1>
        <p className="text-sm text-muted-foreground">
          Customize your restaurant&apos;s branding. Changes are saved locally
          and will be applied when you reload.
        </p>
      </div>

      <hr className="border-border" />

      <AppearanceForm />
    </div>
  );
}
