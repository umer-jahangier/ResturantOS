package io.restaurantos.nlq.aiconfig;

import io.restaurantos.shared.security.EncryptedStringConverter;
import jakarta.persistence.Column;
import jakarta.persistence.Convert;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

import java.time.Instant;
import java.util.UUID;

/**
 * Per-tenant AI / LLM configuration for NLQ (BYOK multi-provider).
 *
 * <p>The {@code apiKey} field is <b>encrypted at rest</b> via shared-lib's
 * {@link EncryptedStringConverter} (AES-256-GCM, random IV per write). In Java it is a plaintext
 * {@code String}; in PostgreSQL it is stored as {@code BYTEA}. This is the same mechanism
 * purchasing-service uses for vendor bank account numbers.
 *
 * <p>RLS on {@code tenant_ai_config} ensures a tenant can only read/write its own row. The
 * {@code UNIQUE(tenant_id)} constraint enforces one config per tenant.
 */
@Entity
@Table(name = "tenant_ai_config")
public class TenantAiConfig {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(name = "tenant_id", nullable = false, unique = true, updatable = false)
    private UUID tenantId;

    @Enumerated(EnumType.STRING)
    @Column(name = "provider", nullable = false, length = 20)
    private AiProvider provider = AiProvider.ANTHROPIC;

    /**
     * The tenant's API key — plaintext in Java, AES-GCM encrypted in the DB.
     * <b>NEVER log this value.</b> The GET endpoint returns a masked version only.
     */
    @Convert(converter = EncryptedStringConverter.class)
    @Column(name = "api_key_encrypted", columnDefinition = "bytea", nullable = false)
    private String apiKey;

    @Column(name = "model_sql", length = 100)
    private String modelSql;

    @Column(name = "model_narrative", length = 100)
    private String modelNarrative;

    @Column(name = "enabled", nullable = false)
    private boolean enabled = true;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt = Instant.now();

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt = Instant.now();

    // ── Getters / Setters ──────────────────────────────────────────────────────

    public UUID getId() { return id; }

    public UUID getTenantId() { return tenantId; }
    public void setTenantId(UUID tenantId) { this.tenantId = tenantId; }

    public AiProvider getProvider() { return provider; }
    public void setProvider(AiProvider provider) { this.provider = provider; }

    public String getApiKey() { return apiKey; }
    public void setApiKey(String apiKey) { this.apiKey = apiKey; }

    public String getModelSql() { return modelSql; }
    public void setModelSql(String modelSql) { this.modelSql = modelSql; }

    public String getModelNarrative() { return modelNarrative; }
    public void setModelNarrative(String modelNarrative) { this.modelNarrative = modelNarrative; }

    public boolean isEnabled() { return enabled; }
    public void setEnabled(boolean enabled) { this.enabled = enabled; }

    public Instant getCreatedAt() { return createdAt; }

    public Instant getUpdatedAt() { return updatedAt; }
    public void setUpdatedAt(Instant updatedAt) { this.updatedAt = updatedAt; }
}
