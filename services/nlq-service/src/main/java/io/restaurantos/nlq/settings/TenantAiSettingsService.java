package io.restaurantos.nlq.settings;

import io.restaurantos.nlq.claude.ClaudeUnavailableException;
import io.restaurantos.nlq.provider.AiCredentialRejectedException;
import io.restaurantos.nlq.provider.AiProviderType;
import io.restaurantos.nlq.provider.LlmCall;
import io.restaurantos.nlq.provider.LlmCredentials;
import io.restaurantos.nlq.provider.LlmProviderRegistry;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

/**
 * Read/replace/clear a tenant's AI provider and API key.
 *
 * <h2>The key goes in and never comes out</h2>
 *
 * <p>{@link #get} builds an {@link AiSettingsView} from the row's non-secret columns only — it
 * never touches {@link AiKeyCipher#decrypt}. There is no method on this class that returns a
 * plaintext key, to any caller, under any parameter.
 *
 * <h2>Save-time verification is tri-state, because the truth is</h2>
 *
 * <table><caption>What the probe means</caption>
 * <tr><th>Probe</th><th>Outcome</th></tr>
 * <tr><td>2xx</td><td>saved, {@link KeyState#VERIFIED}</td></tr>
 * <tr><td>401 / 403</td><td><b>save REFUSED</b>, 400 {@code AI_CREDENTIAL_REJECTED}, nothing persisted</td></tr>
 * <tr><td>timeout / 5xx / network</td><td>saved as {@link KeyState#UNVERIFIED}</td></tr>
 * </table>
 *
 * <p>The third row is the interesting one. Refusing to save during a provider outage would block a
 * perfectly good key for as long as the outage lasts; saving it and reporting "verified" would
 * assert something we did not check. Saving it and SAYING we did not check is the only honest
 * option, and the settings screen renders that state explicitly rather than rounding it to a tick.
 * The first successful live query promotes it (see {@code AiKeyStateWriter.markVerified}).
 */
@Service
public class TenantAiSettingsService {

    private static final Logger log = LoggerFactory.getLogger(TenantAiSettingsService.class);

    /**
     * The cheapest call the provider will accept: {@code max_tokens = 1}. Enough to prove the
     * credential is honoured; not enough to generate anything or cost meaningfully. Auth is
     * checked before generation, so a 1-token cap does not weaken the signal.
     */
    private static final int PROBE_MAX_TOKENS = 1;
    private static final String PROBE_SYSTEM_PROMPT = "Reply with OK.";
    private static final String PROBE_USER_TURN = "ping";

    private final TenantAiSettingsRepository settingsRepository;
    private final AiSettingsEventRepository eventRepository;
    private final AiKeyCipher keyCipher;
    private final LlmProviderRegistry providerRegistry;
    private final AiSettingsProbeRateLimiter probeRateLimiter;
    private final String platformBaseUrl;
    private final String modelSql;
    private final String modelNarrative;

    public TenantAiSettingsService(
            TenantAiSettingsRepository settingsRepository,
            AiSettingsEventRepository eventRepository,
            AiKeyCipher keyCipher,
            LlmProviderRegistry providerRegistry,
            AiSettingsProbeRateLimiter probeRateLimiter,
            @Value("${restaurantos.nlq.anthropic.base-url:https://api.anthropic.com}") String platformBaseUrl,
            @Value("${restaurantos.nlq.anthropic.model-sql}") String modelSql,
            @Value("${restaurantos.nlq.anthropic.model-narrative}") String modelNarrative) {
        this.settingsRepository = settingsRepository;
        this.eventRepository = eventRepository;
        this.keyCipher = keyCipher;
        this.providerRegistry = providerRegistry;
        this.probeRateLimiter = probeRateLimiter;
        this.platformBaseUrl = platformBaseUrl;
        this.modelSql = modelSql;
        this.modelNarrative = modelNarrative;
    }

    /**
     * The current settings. A tenant with no row is not an error and not an empty state — it is
     * "using the platform key", which is a real, correct, and extremely common configuration.
     */
    @Transactional(readOnly = true)
    public AiSettingsView get(UUID tenantId, boolean canManage) {
        return settingsRepository.findByTenantId(tenantId)
                .map(settings -> toView(settings, canManage))
                .orElseGet(() -> platformDefaultView(canManage));
    }

    /**
     * Stores (or replaces) the tenant's key.
     *
     * @throws AiCredentialStorageUnavailableException if field encryption is not configured
     * @throws AiCredentialRejectedException           if the provider refused the key at probe time
     * @throws AiSettingsProbeRateLimitedException     if this tenant has saved too often this hour
     */
    @Transactional
    public AiSettingsView update(UUID tenantId, UUID actorUserId, UpdateAiSettingsRequest request) {
        AiProviderType provider = AiProviderType.parse(request.provider());
        String apiKey = request.apiKey().trim();

        if (!keyCipher.isAvailable()) {
            // Checked BEFORE the probe: no point spending an outbound request on a key we are
            // structurally unable to store.
            throw new AiCredentialStorageUnavailableException(
                    "Field encryption is not configured on nlq-service; a tenant AI key cannot be stored");
        }

        String fingerprint = keyCipher.fingerprint(apiKey);
        Optional<TenantAiSettingsEntity> existing = settingsRepository.findByTenantId(tenantId);

        // Idempotent re-save of an unchanged, working key: no probe, no state churn. Compared by
        // fingerprint so the stored key is never decrypted to answer "is this the same one".
        boolean unchanged = existing.isPresent()
                && existing.get().hasKey()
                && fingerprint.equals(existing.get().getApiKeyFingerprint())
                && existing.get().getProvider() == provider
                && existing.get().getKeyState() == KeyState.VERIFIED;
        if (unchanged) {
            return toView(existing.get(), true);
        }

        probeRateLimiter.consume(tenantId);
        KeyState state = probe(provider, apiKey);

        Instant now = Instant.now();
        TenantAiSettingsEntity settings = existing
                .orElseGet(() -> new TenantAiSettingsEntity(tenantId, provider));
        boolean wasSet = settings.hasKey();
        settings.setProvider(provider);
        settings.storeKey(keyCipher.encrypt(apiKey), keyCipher.last4(apiKey), fingerprint,
                state, actorUserId, now);
        settingsRepository.save(settings);

        eventRepository.save(new AiSettingsEventEntity(tenantId, actorUserId,
                wasSet ? AiSettingsEventEntity.Action.KEY_ROTATED
                       : AiSettingsEventEntity.Action.KEY_SET,
                now));

        return toView(settings, true);
    }

    /** Removes the tenant's key and reverts to the platform key. Keeps the row and its history. */
    @Transactional
    public AiSettingsView clear(UUID tenantId, UUID actorUserId) {
        Optional<TenantAiSettingsEntity> existing = settingsRepository.findByTenantId(tenantId);
        if (existing.isEmpty() || !existing.get().hasKey()) {
            // Already on the platform key. Idempotent, and deliberately not a 404 — the caller
            // asked for a state, and the state holds.
            return existing.map(s -> toView(s, true)).orElseGet(() -> platformDefaultView(true));
        }
        Instant now = Instant.now();
        TenantAiSettingsEntity settings = existing.get();
        settings.clearKey(actorUserId, now);
        settingsRepository.save(settings);
        eventRepository.save(new AiSettingsEventEntity(
                tenantId, actorUserId, AiSettingsEventEntity.Action.KEY_CLEARED, now));
        return toView(settings, true);
    }

    /**
     * One bounded call to the provider with the candidate key.
     *
     * <p>A 401/403 propagates — the save is refused and nothing is persisted, because storing a key
     * the provider has just told us is wrong would put the tenant into a broken state that only
     * shows up at the next question.
     *
     * <p>Every other failure returns {@link KeyState#UNVERIFIED}: an outage is not evidence about
     * the key.
     */
    private KeyState probe(AiProviderType provider, String apiKey) {
        LlmCredentials candidate = new LlmCredentials(platformBaseUrl, apiKey, modelSql, modelNarrative);
        LlmCall call = new LlmCall(modelSql, PROBE_SYSTEM_PROMPT, PROBE_USER_TURN, PROBE_MAX_TOKENS);
        try {
            providerRegistry.get(provider).complete(candidate, call);
            return KeyState.VERIFIED;
        } catch (AiCredentialRejectedException ex) {
            // 400, not 503 — the bad key is a field in the request the caller just sent, and
            // nothing has been persisted. See AiKeyRejectedAtSaveException.
            throw new AiKeyRejectedAtSaveException();
        } catch (ClaudeUnavailableException ex) {
            // No key material in this line — the provider layer never puts any into the message.
            log.warn("[nlq-ai-settings] Save-time probe could not reach {} — storing the key as "
                    + "UNVERIFIED rather than blocking the save", provider, ex);
            return KeyState.UNVERIFIED;
        }
    }

    private AiSettingsView toView(TenantAiSettingsEntity settings, boolean canManage) {
        return new AiSettingsView(
                settings.getProvider(),
                settings.hasKey() ? CredentialSource.TENANT : CredentialSource.PLATFORM,
                settings.getApiKeyLast4(),
                settings.getKeyState(),
                settings.getLastVerifiedAt(),
                settings.getLastRejectedAt(),
                settings.getUpdatedAt(),
                settings.getUpdatedBy(),
                canManage,
                keyCipher.isAvailable());
    }

    /** What a tenant with no row looks like: the platform's key, no state, nothing configured. */
    private AiSettingsView platformDefaultView(boolean canManage) {
        return new AiSettingsView(AiProviderType.ANTHROPIC, CredentialSource.PLATFORM, null,
                KeyState.UNSET, null, null, null, null, canManage, keyCipher.isAvailable());
    }
}
