package io.restaurantos.nlq.provider;

import org.springframework.stereotype.Component;

import java.util.EnumMap;
import java.util.List;
import java.util.Map;

/**
 * Resolves an {@link AiProviderType} to its {@link LlmProvider}.
 *
 * <p>This lookup runs on <b>every NLQ query</b>. That is the point: the seam is exercised by
 * ordinary traffic rather than only by the test that introduced it, so a provider that was added
 * but never wired cannot sit in the enum looking implemented.
 *
 * <p><b>Fails loudly on an unmapped type.</b> A stored {@code provider} value with no bean behind
 * it means a migration widened the CHECK constraint without anyone shipping the implementation —
 * an empty {@code Optional} swallowed at the call site would turn that into "AI silently stopped
 * working for one tenant".
 */
@Component
public class LlmProviderRegistry {

    private final Map<AiProviderType, LlmProvider> byType = new EnumMap<>(AiProviderType.class);

    public LlmProviderRegistry(List<LlmProvider> providers) {
        for (LlmProvider provider : providers) {
            LlmProvider previous = byType.put(provider.type(), provider);
            if (previous != null) {
                throw new IllegalStateException("Two LlmProvider beans claim " + provider.type()
                        + ": " + previous.getClass().getName() + " and " + provider.getClass().getName());
            }
        }
        // Startup assertion, not a runtime one. If an enum value has no implementation, every
        // tenant who selects it discovers it at query time; better to refuse to boot.
        for (AiProviderType type : AiProviderType.values()) {
            if (!byType.containsKey(type)) {
                throw new IllegalStateException(
                        "AiProviderType." + type + " has no LlmProvider implementation. Either ship "
                                + "one or remove the enum value — an unimplemented provider is a "
                                + "feature that reads as present and is not.");
            }
        }
    }

    public LlmProvider get(AiProviderType type) {
        LlmProvider provider = byType.get(type);
        if (provider == null) {
            throw new IllegalStateException("No LlmProvider registered for " + type);
        }
        return provider;
    }
}
