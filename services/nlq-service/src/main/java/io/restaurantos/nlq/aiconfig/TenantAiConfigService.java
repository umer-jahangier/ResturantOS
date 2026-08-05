package io.restaurantos.nlq.aiconfig;

import io.restaurantos.nlq.llm.LlmClient;
import io.restaurantos.nlq.llm.LlmClientFactory;
import io.restaurantos.nlq.llm.LlmNotConfiguredException;
import io.restaurantos.nlq.llm.LlmUnavailableException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

/**
 * Per-tenant AI config CRUD + LLM client resolution (BYOK multi-provider).
 *
 * <p><b>No platform-level fallback.</b> If a tenant has not configured their own key, or their
 * config is disabled, {@link #resolveLlmClient(UUID)} throws {@link LlmNotConfiguredException}
 * (mapped to 503 {@code AI_NOT_CONFIGURED} by the exception handler).
 *
 * <p><b>API keys are never logged or exposed.</b> The {@link #getConfig(UUID)} method returns a
 * DTO with a masked key; the raw key is only used internally when creating an {@link LlmClient}.
 */
@Service
public class TenantAiConfigService {

    private static final Logger log = LoggerFactory.getLogger(TenantAiConfigService.class);

    private final TenantAiConfigRepository repository;
    private final LlmClientFactory llmClientFactory;

    public TenantAiConfigService(TenantAiConfigRepository repository, LlmClientFactory llmClientFactory) {
        this.repository = repository;
        this.llmClientFactory = llmClientFactory;
    }

    // ── Config resolution (used by NlqService at query time) ──────────────────

    /**
     * Resolve the tenant's LLM client from their {@code tenant_ai_config}. Called on every NLQ
     * query request — the client is constructed per-request (lightweight, not pooled).
     *
     * @throws LlmNotConfiguredException if no config exists or it is disabled.
     */
    public LlmClient resolveLlmClient(UUID tenantId) {
        Optional<TenantAiConfig> configOpt = repository.findByTenantId(tenantId);
        if (configOpt.isEmpty()) {
            throw new LlmNotConfiguredException(
                    "AI is not configured for this restaurant. "
                            + "Ask your owner to set up an API key in Settings → AI.");
        }
        TenantAiConfig config = configOpt.get();
        if (!config.isEnabled()) {
            throw new LlmNotConfiguredException(
                    "AI is currently disabled for this restaurant. "
                            + "Ask your owner to re-enable it in Settings → AI.");
        }
        return llmClientFactory.create(config.getProvider(), config.getApiKey(),
                config.getModelSql(), config.getModelNarrative());
    }

    // ── CRUD (used by NlqAiConfigController) ──────────────────────────────────

    /**
     * Get the tenant's AI config as a response DTO (masked key). Returns empty if no config exists.
     */
    @Transactional(readOnly = true)
    public Optional<AiConfigResponse> getConfig(UUID tenantId) {
        return repository.findByTenantId(tenantId).map(this::toResponse);
    }

    /**
     * Create or update the tenant's AI config. Idempotent — if a config already exists for this
     * tenant, it is updated in place.
     */
    @Transactional
    public AiConfigResponse saveConfig(UUID tenantId, AiConfigRequest request) {
        TenantAiConfig config = repository.findByTenantId(tenantId).orElseGet(() -> {
            TenantAiConfig newConfig = new TenantAiConfig();
            newConfig.setTenantId(tenantId);
            return newConfig;
        });
        config.setProvider(request.provider());
        // Only overwrite the key if a new one is provided (non-blank). This allows the tenant to
        // update provider/models without re-entering the key.
        if (request.apiKey() != null && !request.apiKey().isBlank()) {
            config.setApiKey(request.apiKey());
        }
        config.setModelSql(request.modelSql());
        config.setModelNarrative(request.modelNarrative());
        config.setEnabled(request.enabled());
        config.setUpdatedAt(Instant.now());
        return toResponse(repository.save(config));
    }

    /**
     * Delete the tenant's AI config. NLQ becomes unconfigured until re-added.
     */
    @Transactional
    public void deleteConfig(UUID tenantId) {
        repository.deleteByTenantId(tenantId);
    }

    /**
     * Test connection with the provided credentials. Makes a lightweight LLM call to verify the
     * key is valid. Returns success/failure + message.
     */
    public AiConfigTestResponse testConnection(AiConfigTestRequest request) {
        try {
            LlmClient client = llmClientFactory.create(request.provider(), request.apiKey(),
                    request.modelSql(), request.modelNarrative());
            // Lightweight test: ask the model to echo a known string. This validates the key,
            // model access, and network connectivity without running a full NLQ query.
            String result = client.generateSql("Return the number 42",
                    "You are a test. Reply with ONLY: SELECT 42");
            if (result != null && !result.isBlank()) {
                return new AiConfigTestResponse(true, "Connection successful");
            }
            return new AiConfigTestResponse(false, "Received an empty response from the provider");
        } catch (LlmUnavailableException ex) {
            log.info("[nlq-ai-config] Test connection failed for provider {}: {}",
                    request.provider(), ex.getMessage());
            return new AiConfigTestResponse(false, ex.getMessage());
        } catch (RuntimeException ex) {
            log.warn("[nlq-ai-config] Unexpected error during test connection", ex);
            return new AiConfigTestResponse(false, "Unexpected error: " + ex.getMessage());
        }
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private AiConfigResponse toResponse(TenantAiConfig config) {
        return new AiConfigResponse(
                config.getProvider(),
                maskKey(config.getApiKey()),
                config.getModelSql(),
                config.getModelNarrative(),
                config.isEnabled(),
                config.getUpdatedAt());
    }

    /**
     * Masks an API key for display: shows the first 7 chars and last 4, replacing the middle
     * with "****". If the key is too short, shows "****" only.
     */
    static String maskKey(String key) {
        if (key == null) {
            return null;
        }
        if (key.length() <= 11) {
            return "****";
        }
        return key.substring(0, 7) + "****" + key.substring(key.length() - 4);
    }
}
