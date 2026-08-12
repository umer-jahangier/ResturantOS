package io.restaurantos.nlq.settings;

import io.restaurantos.nlq.provider.AiProviderType;
import io.restaurantos.nlq.provider.LlmCredentials;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.util.Optional;
import java.util.UUID;

/**
 * Decides which credential a given tenant's NLQ call uses, and reports whose it is.
 *
 * <h3>The resolution order</h3>
 * <ol>
 *   <li>A row with a non-null ciphertext → decrypt → {@link CredentialSource#TENANT}.</li>
 *   <li>No row, or the key was cleared → the deploy-level key → {@link CredentialSource#PLATFORM}.
 *       This is what keeps every existing tenant working unchanged.</li>
 *   <li>Neither → {@link AiNotConfiguredException}. Somebody has to supply a key; "retry later"
 *       would be a lie.</li>
 * </ol>
 *
 * <h3>A REFUSED tenant key does NOT fall back to the platform key</h3>
 *
 * <p>Fallback is for <i>never set</i>, not for <i>set and broken</i>. Falling back on a rejection
 * would silently bill the platform for a tenant who explicitly opted out of platform billing, and
 * would hide the misconfiguration for as long as nobody happened to look at the settings screen.
 * A tenant who has stated an intent to use their own key gets an error naming that key.
 *
 * <p>Note the asymmetry with a {@code REJECTED} row: this method still returns the tenant key even
 * when {@code key_state = REJECTED}, rather than pre-emptively refusing. The key may have been
 * re-enabled at the provider since, and the authority on whether a credential works is the
 * provider, not a cached column. The call fails, the state is re-stamped, and nothing silently
 * moves to the platform's account.
 *
 * <h3>Base URL and model IDs are platform-pinned</h3>
 *
 * <p>Never tenant input. A tenant-supplied base URL is an SSRF primitive into a service that can
 * reach Postgres, Redis, ClickHouse and Eureka; a tenant-supplied model ID produces provider 404s
 * that are indistinguishable from key failures.
 */
@Component
public class LlmCredentialResolver {

    private final TenantAiSettingsRepository settingsRepository;
    private final AiKeyCipher keyCipher;
    private final String platformApiKey;
    private final String platformBaseUrl;
    private final String modelSql;
    private final String modelNarrative;

    public LlmCredentialResolver(
            TenantAiSettingsRepository settingsRepository,
            AiKeyCipher keyCipher,
            @Value("${restaurantos.nlq.anthropic.api-key:}") String platformApiKey,
            @Value("${restaurantos.nlq.anthropic.base-url:https://api.anthropic.com}") String platformBaseUrl,
            @Value("${restaurantos.nlq.anthropic.model-sql}") String modelSql,
            @Value("${restaurantos.nlq.anthropic.model-narrative}") String modelNarrative) {
        this.settingsRepository = settingsRepository;
        this.keyCipher = keyCipher;
        this.platformApiKey = platformApiKey;
        this.platformBaseUrl = platformBaseUrl;
        this.modelSql = modelSql;
        this.modelNarrative = modelNarrative;
    }

    @Transactional(readOnly = true)
    public ResolvedLlm resolve(UUID tenantId) {
        Optional<TenantAiSettingsEntity> row = tenantId == null
                ? Optional.empty()
                : settingsRepository.findByTenantId(tenantId);

        if (row.isPresent() && row.get().hasKey() && keyCipher.isAvailable()) {
            TenantAiSettingsEntity settings = row.get();
            // The one and only decrypt on the query path. The plaintext lives in this local, goes
            // straight into LlmCredentials (whose toString suppresses it) and is never stored back
            // on the entity, logged, or returned.
            String tenantKey = keyCipher.decrypt(settings.getApiKeyCiphertext());
            return new ResolvedLlm(
                    settings.getProvider(),
                    new LlmCredentials(baseUrlFor(settings.getProvider()), tenantKey, modelSql, modelNarrative),
                    CredentialSource.TENANT);
        }

        // If encryption is unconfigured we cannot read a stored key even if one exists. Treating
        // that as "no tenant key" keeps NLQ working on the platform key rather than 500-ing an
        // entire tenant over an operator's unset environment variable.
        if (platformApiKey == null || platformApiKey.isBlank()) {
            throw new AiNotConfiguredException(
                    "No AI API key is configured for this restaurant, and the platform has no fallback key");
        }

        return new ResolvedLlm(
                AiProviderType.ANTHROPIC,
                new LlmCredentials(platformBaseUrl, platformApiKey, modelSql, modelNarrative),
                CredentialSource.PLATFORM);
    }

    /** Server-side constant per provider. Deliberately not read from the tenant row. */
    private String baseUrlFor(AiProviderType provider) {
        return switch (provider) {
            case ANTHROPIC -> platformBaseUrl;
        };
    }
}
