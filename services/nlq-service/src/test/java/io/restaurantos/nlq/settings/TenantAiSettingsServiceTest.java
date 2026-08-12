package io.restaurantos.nlq.settings;

import io.restaurantos.nlq.claude.ClaudeUnavailableException;
import io.restaurantos.nlq.provider.AiCredentialRejectedException;
import io.restaurantos.nlq.provider.AiProviderType;
import io.restaurantos.nlq.provider.LlmProvider;
import io.restaurantos.nlq.provider.LlmProviderRegistry;
import io.restaurantos.shared.security.EncryptionService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * The save path: the tri-state probe, and the guarantee that a refused key persists NOTHING.
 *
 * <p>The three probe outcomes are not cosmetic. Refusing to save during a provider outage blocks a
 * legitimate key; saving during an outage and reporting "verified" asserts something nobody
 * checked. Only the third answer — save it, and say we could not check — is true, and it is the one
 * the settings screen renders.
 */
class TenantAiSettingsServiceTest {

    private static final String FAKE_KEY = "sk-ant-TEST-not-a-real-key-0000-4242";
    private static final UUID TENANT = UUID.randomUUID();
    private static final UUID ACTOR = UUID.randomUUID();

    /** A throwaway 32-byte AES key for this test only. Not a secret and not used anywhere else. */
    private static final String TEST_ENCRYPTION_KEY_BASE64 =
            java.util.Base64.getEncoder().encodeToString(new byte[32]);

    private TenantAiSettingsRepository settingsRepository;
    private AiSettingsEventRepository eventRepository;
    private AiKeyCipher cipher;
    private LlmProvider provider;
    private AiSettingsProbeRateLimiter rateLimiter;
    private TenantAiSettingsService service;

    @BeforeEach
    void setUp() {
        settingsRepository = mock(TenantAiSettingsRepository.class);
        eventRepository = mock(AiSettingsEventRepository.class);
        cipher = mock(AiKeyCipher.class);
        provider = mock(LlmProvider.class);
        rateLimiter = mock(AiSettingsProbeRateLimiter.class);

        when(cipher.isAvailable()).thenReturn(true);
        // encrypt() delegates to the REAL AES-256-GCM EncryptionService, not to a stub.
        //
        // This was a stub returning ("ENC:" + plaintext) at first, and storedBytesAreNotThePlaintextKey
        // failed against it — correctly. A stub that "encrypts" by prefixing would let that
        // assertion pass or fail on a property of the test double rather than of the system, which
        // is exactly the class of green-but-meaningless test this codebase keeps producing. The
        // real cipher makes the assertion about real stored bytes.
        EncryptionService realEncryption = new EncryptionService(TEST_ENCRYPTION_KEY_BASE64);
        when(cipher.encrypt(any())).thenAnswer(i -> realEncryption.encrypt(i.getArgument(0)));
        when(cipher.fingerprint(any())).thenReturn("fp-of-the-key");
        when(cipher.last4(any())).thenAnswer(i -> {
            String k = i.getArgument(0);
            return k.substring(k.length() - 4);
        });
        when(provider.type()).thenReturn(AiProviderType.ANTHROPIC);
        when(settingsRepository.findByTenantId(TENANT)).thenReturn(Optional.empty());
        when(settingsRepository.save(any())).thenAnswer(i -> i.getArgument(0));

        LlmProviderRegistry registry = new LlmProviderRegistry(List.of(provider));
        service = new TenantAiSettingsService(settingsRepository, eventRepository, cipher, registry,
                rateLimiter, "https://api.anthropic.com", "model-sql", "model-narrative");
    }

    private UpdateAiSettingsRequest request() {
        return new UpdateAiSettingsRequest("ANTHROPIC", FAKE_KEY);
    }

    // ── The tri-state ────────────────────────────────────────────────────────────

    @Test
    @DisplayName("probe accepts → saved as VERIFIED")
    void acceptedKeyIsSavedVerified() {
        when(provider.complete(any(), any())).thenReturn("OK");

        AiSettingsView view = service.update(TENANT, ACTOR, request());

        assertThat(view.keyState()).isEqualTo(KeyState.VERIFIED);
        assertThat(view.source()).isEqualTo(CredentialSource.TENANT);
        assertThat(view.keyLast4()).isEqualTo("4242");
        verify(settingsRepository).save(any());
    }

    @Test
    @DisplayName("probe times out / 5xx → saved as UNVERIFIED, NOT blocked")
    void outageSavesAsUnverified() {
        when(provider.complete(any(), any()))
                .thenThrow(new ClaudeUnavailableException("Anthropic API returned HTTP 503"));

        AiSettingsView view = service.update(TENANT, ACTOR, request());

        assertThat(view.keyState())
                .as("""
                    A provider OUTAGE is not evidence about the key. Refusing the save would block \
                    a perfectly good key for the duration of someone else's incident; saving it as \
                    VERIFIED would claim a check that never happened. UNVERIFIED is the only honest \
                    answer, and the settings screen renders it as such.""")
                .isEqualTo(KeyState.UNVERIFIED);
        verify(settingsRepository).save(any());
    }

    @Test
    @DisplayName("probe is REFUSED → 400, and absolutely nothing is persisted")
    void refusedKeyPersistsNothing() {
        when(provider.complete(any(), any())).thenThrow(new AiCredentialRejectedException());

        assertThatThrownBy(() -> service.update(TENANT, ACTOR, request()))
                .as("a key the provider has already refused must be reported as a bad REQUEST (400), "
                        + "not as a service outage (503)")
                .isInstanceOf(AiKeyRejectedAtSaveException.class);

        // The load-bearing half. Storing a key the provider just rejected would leave the tenant in
        // a broken state that only surfaces at their next question.
        verify(settingsRepository, never()).save(any());
        verify(eventRepository, never()).save(any());
    }

    // ── The key must not escape, on any path ─────────────────────────────────────

    @Test
    @DisplayName("the audit event carries no key material at all")
    void auditEventCarriesNoKeyMaterial() {
        when(provider.complete(any(), any())).thenReturn("OK");

        service.update(TENANT, ACTOR, request());

        ArgumentCaptor<AiSettingsEventEntity> captor =
                ArgumentCaptor.forClass(AiSettingsEventEntity.class);
        verify(eventRepository).save(captor.capture());
        AiSettingsEventEntity event = captor.getValue();

        // Positive control: the event must actually have been written.
        assertThat(event.getAction()).isEqualTo(AiSettingsEventEntity.Action.KEY_SET);
        assertThat(event.getActorUserId()).isEqualTo(ACTOR);

        // An audit table is the classic place a credential ends up: long-lived, widely readable,
        // and nobody re-reads its columns after the review that added them.
        assertThat(event.toString()).doesNotContain(FAKE_KEY);
        assertThat(Arrays.toStringOfFields(event)).doesNotContain(FAKE_KEY).doesNotContain("4242");
    }

    @Test
    @DisplayName("what is persisted is CIPHERTEXT — the plaintext key is never in the stored bytes")
    void storedBytesAreNotThePlaintextKey() {
        when(provider.complete(any(), any())).thenReturn("OK");

        service.update(TENANT, ACTOR, request());

        ArgumentCaptor<TenantAiSettingsEntity> captor =
                ArgumentCaptor.forClass(TenantAiSettingsEntity.class);
        verify(settingsRepository).save(captor.capture());
        byte[] stored = captor.getValue().getApiKeyCiphertext();

        assertThat(stored).as("something must have been stored").isNotNull().isNotEmpty();
        assertThat(new String(stored, StandardCharsets.UTF_8))
                .as("""
                    The bytes written to api_key_ciphertext contained the plaintext key. \
                    AiKeyCipher.encrypt was bypassed, or the entity is storing the raw string.""")
                .doesNotContain(FAKE_KEY);
    }

    // ── Guards around the probe ──────────────────────────────────────────────────

    @Test
    @DisplayName("no encryption → refused before any outbound request is made")
    void refusesToSaveWithoutEncryption() {
        when(cipher.isAvailable()).thenReturn(false);

        assertThatThrownBy(() -> service.update(TENANT, ACTOR, request()))
                .isInstanceOf(AiCredentialStorageUnavailableException.class);

        // No point spending a tenant-driven outbound request on a key we cannot store.
        verify(provider, never()).complete(any(), any());
        verify(settingsRepository, never()).save(any());
    }

    @Test
    @DisplayName("the rate limiter is consulted before the probe fires")
    void rateLimiterGuardsTheProbe() {
        when(provider.complete(any(), any())).thenReturn("OK");

        service.update(TENANT, ACTOR, request());

        // The probe is the only tenant-input-driven OUTBOUND request in this service — an egress
        // oracle and a credential-stuffing harness if uncapped.
        verify(rateLimiter).consume(TENANT);
    }

    @Test
    @DisplayName("an unsupported provider is a 400-shaped failure, not a 500")
    void unsupportedProviderIsRejected() {
        assertThatThrownBy(() ->
                service.update(TENANT, ACTOR, new UpdateAiSettingsRequest("OPENAI", FAKE_KEY)))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("OPENAI");

        verify(provider, never()).complete(any(), any());
    }

    // ── Clearing reverts to the platform key ─────────────────────────────────────

    @Test
    @DisplayName("clearing a key reverts the tenant to the platform key and keeps the row")
    void clearRevertsToPlatform() {
        TenantAiSettingsEntity existing = new TenantAiSettingsEntity(TENANT, AiProviderType.ANTHROPIC);
        existing.storeKey("ct".getBytes(), "4242", "fp", KeyState.VERIFIED, ACTOR,
                java.time.Instant.now());
        when(settingsRepository.findByTenantId(TENANT)).thenReturn(Optional.of(existing));

        AiSettingsView view = service.clear(TENANT, ACTOR);

        assertThat(view.source()).isEqualTo(CredentialSource.PLATFORM);
        assertThat(view.keyState()).isEqualTo(KeyState.UNSET);
        assertThat(view.keyLast4()).isNull();
        // Nulled, not deleted — key_state and the audit columns survive.
        verify(settingsRepository).save(any());
    }

    @Test
    @DisplayName("a tenant with no row reads as 'using the platform key', not as an error")
    void noRowReadsAsPlatformKey() {
        AiSettingsView view = service.get(TENANT, true);

        assertThat(view.source()).isEqualTo(CredentialSource.PLATFORM);
        assertThat(view.keyState()).isEqualTo(KeyState.UNSET);
        assertThat(view.keyLast4()).isNull();
    }

    /** Tiny reflection helper: dumps every field value so the key cannot hide in one. */
    private static final class Arrays {
        static String toStringOfFields(Object o) {
            StringBuilder sb = new StringBuilder();
            for (java.lang.reflect.Field f : o.getClass().getDeclaredFields()) {
                f.setAccessible(true);
                try {
                    sb.append(f.getName()).append('=').append(f.get(o)).append(';');
                } catch (IllegalAccessException ignored) {
                    // A field we cannot read cannot be asserted on; nothing here is inaccessible.
                }
            }
            return sb.toString();
        }
    }
}
