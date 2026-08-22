"use client";

import { AccessDenied } from "@/components/shared/access-denied";
import { PermissionGuard } from "@/components/shared/permission-guard";
import { AiSettingsForm } from "@/components/settings/ai-settings-form";
import { PageHeader } from "@/components/ui/page-header";
import { ZoneProvider } from "@/components/providers/zone-provider";

/**
 * URL: /app/settings/ai — Program C.
 *
 * <h2>What was actually missing</h2>
 *
 * <p>The NLQ feature shipped complete except for who pays for it. `ClaudeClient` read a single
 * `restaurantos.nlq.anthropic.api-key` from deploy config, so every tenant on the platform sent
 * their questions on ONE Anthropic account — no per-tenant attribution, no per-tenant quota, no
 * isolation between restaurants that have no commercial relationship with each other. The user
 * asked for this screen before and it was never built.
 *
 * <h2>The permission, and why it is a new one</h2>
 *
 * <p>Gated on `nlq.settings.manage`, granted to OWNER and TENANT_ADMIN (auth changeset 094).
 * `nlq.query.run` — which a MANAGER and an ACCOUNTANT both hold — asks a question. This decides
 * which account every question in the restaurant is billed to, and hands the platform a
 * credential. Same split 091 made for tax and 093 for the service charge.
 *
 * <p>Unlike the service-charge screen, a MANAGER is NOT admitted read-only. There is nothing here
 * they have to defend to a guest: the screen shows a provider, a key state, and four characters of
 * a credential. Admitting them would widen who can see the billing posture for no operational gain.
 *
 * <h2>Why it is a PERMISSION rather than a role check</h2>
 *
 * <p>A previous attempt at this feature (`origin/Mufazzal` @ d11d4ae5) guarded its endpoints with
 * `hasAnyAuthority('ROLE_OWNER','ROLE_TENANT_ADMIN')`. Shared-lib's `JwtAuthenticationFilter`
 * never adds a `ROLE_` prefix, so that check 403s every caller including the owner — a complete
 * settings surface that reads correctly and cannot run. A permission also lets changeset 092's
 * tenant custom roles hold it.
 *
 * <h2>Reached from the sidebar</h2>
 *
 * <p>Registered in `sidebar-nav-items.ts` under Settings. A screen with no navigation entry is a
 * screen nobody finds — which is how the printer screen stayed unbuilt for a phase and a half.
 */
function AiSettingsPage() {
  return (
    /*
     * ZONE: expressive (D-34-02) — settings is named in that decision's table. Nested inside the
     * restrained back-office shell exactly as /app/settings/service-charge and /printers are.
     */
    <ZoneProvider zone="expressive" className="space-y-6">
      <PageHeader
        title="AI"
        description="Which AI provider answers your questions, and whose account it bills to."
      />

      <AiSettingsForm />
    </ZoneProvider>
  );
}

export default function AiSettingsRoute() {
  return (
    <PermissionGuard
      require={["nlq.settings.manage"]}
      fallback={
        <AccessDenied
          title="Access denied"
          description="Setting this restaurant's AI provider and API key is held by an owner or a tenant administrator."
        />
      }
    >
      <AiSettingsPage />
    </PermissionGuard>
  );
}
