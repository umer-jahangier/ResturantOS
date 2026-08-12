import { z } from "zod";

/**
 * Wire shape of a tenant's AI provider + credential (Program C).
 *
 * ```
 * GET    /api/v1/nlq/settings/ai   nlq.settings.manage
 * PUT    /api/v1/nlq/settings/ai   nlq.settings.manage   { provider, apiKey }
 * DELETE /api/v1/nlq/settings/ai   nlq.settings.manage   -> revert to the platform key
 * ```
 *
 * <h3>`.strict()` is the client half of "the API never returns the key"</h3>
 *
 * The server has no `apiKey` field on its response record, so it structurally cannot send one.
 * `.strict()` makes this side refuse it too: if a future server change ever starts echoing a key
 * back, the parse THROWS here rather than quietly handing the credential to the render tree, where
 * it would land in React DevTools, in any error reporter, and in a screenshot.
 *
 * Two independent guards for one property, deliberately. The server-side one is the real
 * protection; this one turns a server regression into a loud client failure instead of a silent
 * leak. `ai-settings.schema.test.ts` asserts the throw.
 *
 * The GET never 404s: a tenant nobody has configured answers with `source: "PLATFORM"`, which is a
 * real configuration (the platform's own key) and not an absence. That is what lets the screen
 * render one form for both cases instead of an empty state it would have to explain.
 */
export const apiAiSettingsSchema = z
  .object({
    /** Only ANTHROPIC ships in v1. A seam exists server-side; the enum does not pretend otherwise. */
    provider: z.enum(["ANTHROPIC"]),

    /** TENANT = this restaurant's own key. PLATFORM = the built-in platform key. */
    source: z.enum(["TENANT", "PLATFORM"]),

    /**
     * Last FOUR characters of the stored key, or null when there is none.
     *
     * The entire masked hint. Not "first 7 and last 4" — the provider prefix is still key material
     * the screen does not need.
     */
    keyLast4: z.string().max(4).nullable(),

    /**
     * UNSET      — no tenant key; the platform key is in use.
     * UNVERIFIED — saved, but the provider was unreachable at save time. Not a failure.
     * VERIFIED   — the provider accepted it.
     * REJECTED   — the provider refused it. Actionable: replace the key.
     */
    keyState: z.enum(["UNSET", "UNVERIFIED", "VERIFIED", "REJECTED"]),

    lastVerifiedAt: z.string().nullable(),
    lastRejectedAt: z.string().nullable(),
    updatedAt: z.string().nullable(),
    updatedBy: z.string().uuid().nullable(),

    /** Whether THIS caller may change it — the server owns the permission catalogue. */
    canManage: z.boolean(),

    /**
     * False when the server has no field-encryption key configured, so the screen can explain why
     * saving is refused instead of presenting a form that always 503s.
     */
    storageAvailable: z.boolean(),
  })
  .strict();

export type ApiAiSettings = z.infer<typeof apiAiSettingsSchema>;

/**
 * PUT body. `apiKey` travels in exactly one direction and is never read back.
 *
 * No format/prefix validation on purpose. A client-side check on the shape of a provider token
 * ages badly — Anthropic has changed its prefix before — and would reject a valid key with a
 * message the user cannot act on. The authoritative check is the server's save-time probe, which
 * asks the provider itself; the length bound here is only a sanity limit.
 */
export const updateAiSettingsInputSchema = z.object({
  provider: z.enum(["ANTHROPIC"]),
  apiKey: z.string().min(8).max(512),
});
export type UpdateAiSettingsInput = z.infer<typeof updateAiSettingsInputSchema>;
