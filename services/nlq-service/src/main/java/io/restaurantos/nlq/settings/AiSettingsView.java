package io.restaurantos.nlq.settings;

import io.restaurantos.nlq.provider.AiProviderType;

import java.time.Instant;
import java.util.UUID;

/**
 * Everything the AI-settings API returns. <b>This is the complete field list.</b>
 *
 * <h3>There is no key field, and that is a structural guarantee rather than a convention</h3>
 *
 * <p>There is no {@code apiKey} component, no {@code reveal} endpoint, no {@code ?includeKey}
 * parameter, and no code path anywhere that decrypts on a read. A GET that echoes the key back is
 * the exact defect this design was written to make impossible: not "we remembered to mask it", but
 * "there is nothing here to mask".
 *
 * <p>{@link #keyLast4()} is the only key-derived value present — four characters, enough for an
 * owner to recognise which key is installed and useless to anyone else. The stored
 * {@code api_key_fingerprint} is deliberately NOT here; it is a server-side equality probe and
 * publishing it would let a holder of a candidate key confirm a match offline.
 *
 * <p>The "replace" action is a plain PUT with a new key. Nothing needs to read the old one back.
 *
 * <p>If a future change adds a component to this record, {@code TenantAiSettingsIT} fails: it
 * asserts over {@code AiSettingsView.class.getRecordComponents()} rather than over one hand-built
 * JSON body, so the guarantee is checked against the type, not against a sample.
 */
public record AiSettingsView(
        AiProviderType provider,

        /** TENANT = this restaurant's own key is in use. PLATFORM = the built-in platform key. */
        CredentialSource source,

        /** Last four characters of the stored key, or null when there is none. */
        String keyLast4,

        KeyState keyState,
        Instant lastVerifiedAt,
        Instant lastRejectedAt,
        Instant updatedAt,
        UUID updatedBy,

        /** Whether THIS caller may change it — the server owns the permission catalogue. */
        boolean canManage,

        /**
         * False when {@code restaurantos.encryption.key} is unset on this service, so the screen
         * can explain why saving is refused instead of showing a form that always 503s.
         */
        boolean storageAvailable) {
}
