package io.restaurantos.nlq.settings;

import io.restaurantos.nlq.provider.AiProviderType;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * The fallback rules — the requirement that "nothing regresses today".
 *
 * <p>Every existing tenant has no row in {@code nlq_tenant_ai_settings}, so
 * {@link LlmCredentialResolver#resolve} returning the PLATFORM key for that case is the entire
 * backward-compatibility guarantee of this feature. If it ever returns something else, NLQ breaks
 * for every tenant on the platform at once.
 *
 * <p>The interesting assertion is the negative one: a tenant key that the provider has REFUSED
 * must NOT fall back to the platform key. Fallback is for <i>never set</i>, not <i>set and
 * broken</i> — silently switching a rejected tenant onto the platform's account would bill the
 * platform for someone who explicitly opted out, and would hide the misconfiguration for as long
 * as nobody looked at the settings screen.
 */
class LlmCredentialResolverTest {

    private static final String PLATFORM_KEY = "platform-key-NOT-REAL-0000";
    private static final String TENANT_KEY = "sk-ant-TEST-tenant-key-1111";
    private static final String BASE_URL = "https://api.anthropic.com";

    private TenantAiSettingsRepository repository;
    private AiKeyCipher cipher;
    private LlmCredentialResolver resolver;

    @BeforeEach
    void setUp() {
        repository = mock(TenantAiSettingsRepository.class);
        cipher = mock(AiKeyCipher.class);
        when(cipher.isAvailable()).thenReturn(true);
        when(cipher.decrypt(any())).thenReturn(TENANT_KEY);
        resolver = new LlmCredentialResolver(repository, cipher, PLATFORM_KEY, BASE_URL,
                "model-sql", "model-narrative");
    }

    private TenantAiSettingsEntity rowWithKey(UUID tenantId, KeyState state) {
        TenantAiSettingsEntity entity = new TenantAiSettingsEntity(tenantId, AiProviderType.ANTHROPIC);
        entity.storeKey("ciphertext".getBytes(), "1111", "fp", state, UUID.randomUUID(), Instant.now());
        if (state == KeyState.REJECTED) {
            entity.markRejected(Instant.now());
        }
        return entity;
    }

    // ── Fallback: the backward-compatibility guarantee ───────────────────────────

    @Test
    @DisplayName("no row at all → the platform key (this is every tenant on the platform today)")
    void fallsBackToPlatformWhenNoTenantRow() {
        UUID tenantId = UUID.randomUUID();
        when(repository.findByTenantId(tenantId)).thenReturn(Optional.empty());

        ResolvedLlm resolved = resolver.resolve(tenantId);

        assertThat(resolved.source())
                .as("""
                    A tenant with no settings row MUST resolve to the PLATFORM key. Every tenant \
                    currently on this platform is in exactly this state, so any other answer here \
                    breaks NLQ for all of them simultaneously — the regression the "fall back to \
                    the deploy-level key" requirement exists to prevent.""")
                .isEqualTo(CredentialSource.PLATFORM);
        assertThat(resolved.credentials().apiKey()).isEqualTo(PLATFORM_KEY);
    }

    @Test
    @DisplayName("a cleared key → back to the platform key")
    void fallsBackToPlatformWhenKeyCleared() {
        UUID tenantId = UUID.randomUUID();
        TenantAiSettingsEntity cleared = rowWithKey(tenantId, KeyState.VERIFIED);
        cleared.clearKey(UUID.randomUUID(), Instant.now());
        when(repository.findByTenantId(tenantId)).thenReturn(Optional.of(cleared));

        ResolvedLlm resolved = resolver.resolve(tenantId);

        assertThat(resolved.source()).isEqualTo(CredentialSource.PLATFORM);
        assertThat(resolved.credentials().apiKey()).isEqualTo(PLATFORM_KEY);
    }

    // ── The tenant key wins when there is one ────────────────────────────────────

    @Test
    @DisplayName("a stored key → the tenant's own key, marked TENANT")
    void usesTenantKeyWhenPresent() {
        UUID tenantId = UUID.randomUUID();
        when(repository.findByTenantId(tenantId))
                .thenReturn(Optional.of(rowWithKey(tenantId, KeyState.VERIFIED)));

        ResolvedLlm resolved = resolver.resolve(tenantId);

        assertThat(resolved.source()).isEqualTo(CredentialSource.TENANT);
        assertThat(resolved.credentials().apiKey()).isEqualTo(TENANT_KEY);
        assertThat(resolved.credentials().apiKey())
                .as("the platform key must not leak into a tenant-key resolution")
                .isNotEqualTo(PLATFORM_KEY);
    }

    @Test
    @DisplayName("a REJECTED tenant key does NOT silently fall back to the platform key")
    void doesNotFallBackWhenTenantKeyRejected() {
        UUID tenantId = UUID.randomUUID();
        when(repository.findByTenantId(tenantId))
                .thenReturn(Optional.of(rowWithKey(tenantId, KeyState.REJECTED)));

        ResolvedLlm resolved = resolver.resolve(tenantId);

        assertThat(resolved.source())
                .as("""
                    A tenant whose key the provider REFUSED must still resolve to TENANT. Falling \
                    back to PLATFORM here would silently bill the platform for a tenant who \
                    explicitly opted out of platform billing, and would hide the broken key for as \
                    long as nobody happened to open the settings screen. Fallback is for NEVER SET, \
                    not for SET AND BROKEN.""")
                .isEqualTo(CredentialSource.TENANT);
        assertThat(resolved.credentials().apiKey()).isEqualTo(TENANT_KEY);
    }

    // ── Nothing configured anywhere ──────────────────────────────────────────────

    @Test
    @DisplayName("no tenant key and no platform key → AI_NOT_CONFIGURED, not a generic outage")
    void throwsWhenNothingConfigured() {
        UUID tenantId = UUID.randomUUID();
        when(repository.findByTenantId(tenantId)).thenReturn(Optional.empty());
        LlmCredentialResolver bare = new LlmCredentialResolver(repository, cipher, "  ", BASE_URL,
                "model-sql", "model-narrative");

        assertThatThrownBy(() -> bare.resolve(tenantId))
                .isInstanceOf(AiNotConfiguredException.class);
    }

    // ── Encryption unavailable must degrade, not explode ─────────────────────────

    @Test
    @DisplayName("encryption unconfigured → platform key, so NLQ keeps working for everyone else")
    void unavailableEncryptionDegradesToPlatformKey() {
        UUID tenantId = UUID.randomUUID();
        when(cipher.isAvailable()).thenReturn(false);
        when(repository.findByTenantId(tenantId))
                .thenReturn(Optional.of(rowWithKey(tenantId, KeyState.VERIFIED)));

        ResolvedLlm resolved = resolver.resolve(tenantId);

        // An operator's unset FIELD_ENCRYPTION_KEY must not 500 an entire tenant's analytics.
        assertThat(resolved.source()).isEqualTo(CredentialSource.PLATFORM);
    }

    // ── The base URL is never tenant-controlled ──────────────────────────────────

    @Test
    @DisplayName("the base URL is a server-side constant, not anything the row could carry")
    void baseUrlIsAlwaysTheServerSideConstant() {
        UUID tenantId = UUID.randomUUID();
        when(repository.findByTenantId(tenantId))
                .thenReturn(Optional.of(rowWithKey(tenantId, KeyState.VERIFIED)));

        // A tenant-supplied base URL would be an SSRF primitive into a service that can reach
        // Postgres, Redis, ClickHouse and Eureka. There is deliberately no column for it.
        assertThat(resolver.resolve(tenantId).credentials().baseUrl()).isEqualTo(BASE_URL);
    }
}
