package io.restaurantos.nlq.settings;

/**
 * The service cannot store a tenant API key because field encryption is not configured
 * ({@code restaurantos.encryption.key} / {@code FIELD_ENCRYPTION_KEY} unset), or the stored
 * ciphertext cannot be decrypted with the key this process holds.
 *
 * <h3>Why nlq-service does NOT fail-fast at boot on a missing encryption key</h3>
 *
 * <p>purchasing-service has an {@code EncryptionRequiredConfig} that refuses to start without one.
 * Copying that here would be wrong: nlq-service is running in production right now without the
 * property, and refusing to boot would take NLQ away from every tenant who never set a key — the
 * exact regression the fallback-to-platform-key requirement exists to prevent.
 *
 * <p>So the posture is graded instead of binary:
 * <ul>
 *   <li>startup logs a WARN naming the property;</li>
 *   <li>the settings <b>write</b> path fails with this exception → 503
 *       {@code AI_CREDENTIAL_STORAGE_UNAVAILABLE}, which tells an operator precisely what to set;</li>
 *   <li>the resolver treats "no encryption service" as "no tenant key" and uses the platform key,
 *       so reads and queries keep working.</li>
 * </ul>
 *
 * <p>Loud where it matters, not fatal where it does not.
 *
 * <h3>The rotation hazard this also covers</h3>
 *
 * <p>{@code FIELD_ENCRYPTION_KEY} becomes load-bearing for nlq-service the moment any tenant saves
 * a key. Rotating it invalidates every stored credential, and there is no re-encrypt tooling
 * anywhere in this repo (hr-service and purchasing-service already carry the same latent risk).
 * A decrypt failure surfaces here as a named 503 rather than an unhandled
 * {@code IllegalStateException} → 500.
 */
public class AiCredentialStorageUnavailableException extends RuntimeException {

    public AiCredentialStorageUnavailableException(String message) {
        super(message);
    }

    public AiCredentialStorageUnavailableException(String message, Throwable cause) {
        // NOTE: the cause is retained for the server-side stack trace only. The exception handler
        // never puts getMessage() OR the cause on the wire — a decryption failure message can
        // carry cipher details that are nobody's business outside this process.
        super(message, cause);
    }
}
