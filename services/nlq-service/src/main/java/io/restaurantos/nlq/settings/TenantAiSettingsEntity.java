package io.restaurantos.nlq.settings;

import io.restaurantos.nlq.provider.AiProviderType;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

import java.time.Instant;
import java.util.UUID;

/**
 * A tenant's AI provider + credential.
 *
 * <h2>THIS ENTITY CANNOT LEAK THE KEY, BECAUSE IT NEVER HOLDS IT</h2>
 *
 * <p>The credential lives here as {@code byte[] apiKeyCiphertext} and in no other form. There is
 * no {@code String apiKey} field, no getter that returns plaintext, and no
 * {@code @Convert(converter = EncryptedStringConverter.class)}.
 *
 * <h3>Why NOT @Convert, when hr-service and purchasing-service both use it</h3>
 *
 * <p><b>This deviation from the house style is deliberate. Do not "fix" it back.</b>
 *
 * <p>{@code @Convert} decrypts on <b>every</b> load, so the plaintext key materialises on the
 * entity whenever anyone reads the row — including a pure display read. The earlier attempt at
 * this feature ({@code origin/Mufazzal}) shows the consequence precisely: its
 * {@code toResponse()} called {@code maskKey(config.getApiKey())}, so rendering "•••• 4242"
 * required decrypting the key into the heap, and the only thing standing between that object and
 * the wire was one helper method that nobody was forced to call. A single
 * {@code ApiResponse.ok(entity)} — the shape used all over this codebase — and the key ships.
 *
 * <p>With ciphertext-only, that mistake is not available. {@code EncryptionService} is injected
 * into exactly one collaborator ({@code TenantAiCredentialResolver}) which decrypts at the point
 * of the provider call and nowhere else. Serialising this entity produces bytes, not a key.
 *
 * <p>(Secondary reason: {@code EncryptedStringConverter} holds its service in a {@code static}
 * field initialised at context startup — global mutable state that misbehaves across test
 * contexts. Skipping it costs nothing here.)
 *
 * <h3>The fingerprint is not a second copy of the key</h3>
 *
 * <p>{@code apiKeyFingerprint} is {@code sha256(key)} hex. It answers "is this the same key you
 * already had" — needed so a re-save of an unchanged key does not burn a probe or reset
 * {@code keyState} — <b>without decrypting anything</b>. It is never returned by the API.
 *
 * <h3>No row means the platform key</h3>
 *
 * <p>Absence is a valid, common state and the pre-existing behaviour: a tenant who never opened
 * this screen keeps working exactly as before. Clearing a key NULLs the ciphertext rather than
 * deleting the row, so {@code keyState} and the audit columns survive.
 */
@Entity
@Table(name = "nlq_tenant_ai_settings")
public class TenantAiSettingsEntity {

    @Id
    @Column(name = "tenant_id", nullable = false, updatable = false)
    private UUID tenantId;

    @Enumerated(EnumType.STRING)
    @Column(name = "provider", nullable = false, length = 20)
    private AiProviderType provider;

    /** AES-256-GCM ciphertext, 12-byte IV prefixed. NULL = cleared, falls back to the platform key. */
    @Column(name = "api_key_ciphertext")
    private byte[] apiKeyCiphertext;

    /** The ONLY key-derived value that may ever cross the API boundary. */
    @Column(name = "api_key_last4", length = 4)
    private String apiKeyLast4;

    /** sha256(key) hex — a server-side equality probe. NEVER returned by the API. */
    @Column(name = "api_key_fingerprint", length = 64)
    private String apiKeyFingerprint;

    @Enumerated(EnumType.STRING)
    @Column(name = "key_state", nullable = false, length = 16)
    private KeyState keyState = KeyState.UNSET;

    @Column(name = "last_verified_at")
    private Instant lastVerifiedAt;

    @Column(name = "last_rejected_at")
    private Instant lastRejectedAt;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt = Instant.now();

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt = Instant.now();

    @Column(name = "updated_by")
    private UUID updatedBy;

    protected TenantAiSettingsEntity() {
        // JPA
    }

    public TenantAiSettingsEntity(UUID tenantId, AiProviderType provider) {
        this.tenantId = tenantId;
        this.provider = provider;
    }

    public UUID getTenantId() {
        return tenantId;
    }

    public AiProviderType getProvider() {
        return provider;
    }

    public void setProvider(AiProviderType provider) {
        this.provider = provider;
    }

    /**
     * The stored ciphertext. Callers get bytes and must go through
     * {@code TenantAiCredentialResolver} to obtain a usable key — there is no shortcut on this
     * class, on purpose.
     */
    public byte[] getApiKeyCiphertext() {
        return apiKeyCiphertext;
    }

    public String getApiKeyLast4() {
        return apiKeyLast4;
    }

    public String getApiKeyFingerprint() {
        return apiKeyFingerprint;
    }

    public boolean hasKey() {
        return apiKeyCiphertext != null;
    }

    public KeyState getKeyState() {
        return keyState;
    }

    public Instant getLastVerifiedAt() {
        return lastVerifiedAt;
    }

    public Instant getLastRejectedAt() {
        return lastRejectedAt;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public Instant getUpdatedAt() {
        return updatedAt;
    }

    public UUID getUpdatedBy() {
        return updatedBy;
    }

    /**
     * Installs a new credential. The three key-derived columns move together — the migration's
     * {@code last4_chk} CHECK enforces the same invariant at the database, so a future code path
     * that sets one without the others fails loudly instead of leaving the screen showing a mask
     * for a key the resolver has already stopped using.
     */
    public void storeKey(byte[] ciphertext, String last4, String fingerprint, KeyState state,
                          UUID actorUserId, Instant now) {
        this.apiKeyCiphertext = ciphertext;
        this.apiKeyLast4 = last4;
        this.apiKeyFingerprint = fingerprint;
        this.keyState = state;
        this.lastVerifiedAt = state == KeyState.VERIFIED ? now : null;
        this.lastRejectedAt = null;
        this.updatedBy = actorUserId;
        this.updatedAt = now;
    }

    /** Reverts to the platform key. NULLs the credential; keeps the row and its history. */
    public void clearKey(UUID actorUserId, Instant now) {
        this.apiKeyCiphertext = null;
        this.apiKeyLast4 = null;
        this.apiKeyFingerprint = null;
        this.keyState = KeyState.UNSET;
        this.lastVerifiedAt = null;
        this.lastRejectedAt = null;
        this.updatedBy = actorUserId;
        this.updatedAt = now;
    }

    /**
     * Records that the provider refused this key.
     *
     * <p>Only ever called for a real 401/403 — a network blip must not brand a good key as bad.
     * Written in a {@code REQUIRES_NEW} transaction by the caller so it survives the rollback of
     * the request that discovered it.
     */
    public void markRejected(Instant now) {
        if (apiKeyCiphertext == null) {
            // Nothing to reject: the row carries no key, so REJECTED would contradict the
            // migration's state_agrees_chk and would misreport a platform-key failure as the
            // tenant's fault.
            return;
        }
        this.keyState = KeyState.REJECTED;
        this.lastRejectedAt = now;
        this.updatedAt = now;
    }

    /** Records a successful live use — promotes UNVERIFIED to VERIFIED without a separate probe. */
    public void markVerified(Instant now) {
        if (apiKeyCiphertext == null) {
            return;
        }
        this.keyState = KeyState.VERIFIED;
        this.lastVerifiedAt = now;
        this.updatedAt = now;
    }

    /**
     * NO {@code toString()} OVERRIDE IS NEEDED and none should be added that prints the ciphertext.
     * The default {@code Object.toString()} prints an identity hash, which is exactly right.
     */
}
