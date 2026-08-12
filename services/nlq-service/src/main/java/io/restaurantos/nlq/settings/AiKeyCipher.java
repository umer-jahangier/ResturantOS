package io.restaurantos.nlq.settings;

import io.restaurantos.shared.security.EncryptionService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;

/**
 * The ONLY place in nlq-service that turns an API key into ciphertext and back.
 *
 * <p>Concentrating it here is the point: {@code EncryptionService} is injected into this class and
 * this class alone, so the set of code that can produce a plaintext key is one file long and stays
 * that way.
 *
 * <h3>Why this builds its own EncryptionService instead of injecting shared-lib's bean</h3>
 *
 * <p>shared-lib's {@code EncryptionAutoConfiguration} is
 * {@code @ConditionalOnProperty("restaurantos.encryption.key")}, which matches a property that is
 * <b>present but blank</b>. Every service that writes {@code key: ${FIELD_ENCRYPTION_KEY:}} in its
 * YAML therefore hands {@code EncryptionService} an empty string whenever the variable is unset,
 * and {@code new SecretKeySpec(Base64.decode(""), "AES")} throws
 * {@code IllegalArgumentException: Empty key} — the application context never starts.
 *
 * <p>That is not hypothetical: adding the conventional block to nlq-service's
 * {@code application.yml} took all 14 {@code NlqServiceIT} tests from green to "Failed to load
 * ApplicationContext" on 2026-08-12. auth-service and hr-service both carry that shape today and
 * survive only because {@code deploy/.env} sets the variable.
 *
 * <p>So nlq-service reads the raw value, checks it for blankness FIRST, and constructs the
 * (shared-lib) {@code EncryptionService} only when there is a real key. Blank means "no field
 * encryption", degraded exactly as {@link AiCredentialStorageUnavailableException} describes —
 * never a boot failure.
 */
@Component
public class AiKeyCipher {

    private static final Logger log = LoggerFactory.getLogger(AiKeyCipher.class);

    /** Null when no key is configured. The single source of "can we store a credential at all". */
    private final EncryptionService encryptionService;

    public AiKeyCipher(@Value("${restaurantos.ai-encryption-key:}") String base64Key) {
        EncryptionService built = null;
        if (base64Key != null && !base64Key.isBlank()) {
            try {
                built = new EncryptionService(base64Key.trim());
            } catch (RuntimeException ex) {
                // A malformed key must not take the service down either — same reasoning as blank.
                // Logged WITHOUT the value: it is a secret even when it is the wrong shape.
                log.error("[nlq-ai-settings] FIELD_ENCRYPTION_KEY is set but is not a valid "
                        + "base64 AES key. Tenant AI keys cannot be stored. NLQ still works on the "
                        + "platform key.");
            }
        }
        this.encryptionService = built;
        if (this.encryptionService == null) {
            log.warn("[nlq-ai-settings] Field encryption is NOT configured "
                    + "(FIELD_ENCRYPTION_KEY is unset or invalid). Tenants cannot save their own AI "
                    + "API key; every tenant will use the platform key. NLQ itself keeps working.");
        }
    }

    /** True when a tenant key can actually be stored. The settings write path checks this first. */
    public boolean isAvailable() {
        return encryptionService != null;
    }

    public byte[] encrypt(String plaintextKey) {
        EncryptionService service = require();
        return service.encrypt(plaintextKey);
    }

    /**
     * @throws AiCredentialStorageUnavailableException if encryption is unconfigured, or if the
     *         ciphertext cannot be decrypted with the key this process holds — which is what a
     *         rotated {@code FIELD_ENCRYPTION_KEY} looks like. Surfacing it as a named condition
     *         keeps it out of the 500 bucket.
     */
    public String decrypt(byte[] ciphertext) {
        EncryptionService service = require();
        try {
            return service.decrypt(ciphertext);
        } catch (RuntimeException ex) {
            // The cause is kept for the local stack trace; the message deliberately carries no
            // cipher detail and the handler never puts it on the wire.
            throw new AiCredentialStorageUnavailableException(
                    "Stored AI credential could not be decrypted with the current field-encryption key", ex);
        }
    }

    /**
     * {@code sha256(key)} as lowercase hex — lets a re-save detect "same key as before" without
     * decrypting the stored one, so an unchanged key does not burn a provider probe or reset a
     * VERIFIED state to UNVERIFIED.
     *
     * <p>A plain unsalted digest is right here and a password hash would be wrong: the input is a
     * 100+ bit random provider token, not a human-chosen secret, so there is nothing to brute
     * force, and the value must be deterministic across rows to be comparable at all.
     */
    public String fingerprint(String plaintextKey) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            return HexFormat.of().formatHex(digest.digest(plaintextKey.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException ex) {
            throw new IllegalStateException("SHA-256 unavailable", ex);
        }
    }

    /**
     * The last four characters — the entire masked hint the API is permitted to return.
     *
     * <p>Four, not "the first 7 and the last 4". The earlier attempt at this feature masked as
     * {@code sk-ant-…4242}, which hands back the provider prefix as well; the prefix is low-value
     * but it is still key material the caller did not need. A short key (never a real one) yields
     * an empty hint rather than the whole thing.
     */
    public String last4(String plaintextKey) {
        if (plaintextKey == null || plaintextKey.length() < 4) {
            return "";
        }
        return plaintextKey.substring(plaintextKey.length() - 4);
    }

    private EncryptionService require() {
        if (encryptionService == null) {
            throw new AiCredentialStorageUnavailableException(
                    "Field encryption is not configured on nlq-service; a tenant AI key cannot be stored");
        }
        return encryptionService;
    }
}
