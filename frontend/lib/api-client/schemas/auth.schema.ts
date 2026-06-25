import { z } from "zod";

// RAW API field names (camelCase, per the auth-service contract D3). This module
// is the ONLY place that knows the wire shape — repositories `.parse()` here and
// adapters convert to domain models. NEVER use `.safeParse` (it swallows drift).

/** POST /api/v1/auth/login success body. */
export const apiLoginSchema = z.object({
  accessToken: z.string(),
  expiresInSeconds: z.number(),
  userId: z.string().uuid(),
  tenantId: z.string().uuid(),
  branchId: z.string().uuid(),
});

/** POST /api/v1/auth/refresh and /switch-branch success body. */
export const apiTokenSchema = z.object({
  accessToken: z.string(),
  expiresInSeconds: z.number(),
});

/** Feature-flags endpoint (D4 — shape mocked in Phase 4; confirm live contract). */
export const apiFeatureFlagsSchema = z.object({
  features: z.array(z.string()),
});

export type ApiLogin = z.infer<typeof apiLoginSchema>;
export type ApiToken = z.infer<typeof apiTokenSchema>;
export type ApiFeatureFlags = z.infer<typeof apiFeatureFlagsSchema>;
