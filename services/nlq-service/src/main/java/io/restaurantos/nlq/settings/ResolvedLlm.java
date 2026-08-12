package io.restaurantos.nlq.settings;

import io.restaurantos.nlq.provider.AiProviderType;
import io.restaurantos.nlq.provider.LlmCredentials;

/**
 * The outcome of credential resolution for one tenant: which provider, which key, and — crucially
 * — <b>whose</b> key.
 *
 * <p>{@code source} is not decoration. It decides three separate behaviours:
 * <ul>
 *   <li>whether a 401 flips the tenant's {@code key_state} to REJECTED, or is somebody else's
 *       operational problem;</li>
 *   <li>which sentence the owner is shown when a call fails;</li>
 *   <li>which account the traffic bills to — the reason this feature exists at all.</li>
 * </ul>
 *
 * <p>No {@code toString()} override is needed: {@link LlmCredentials} already suppresses the key
 * in its own, and a record's generated {@code toString} delegates to the component's.
 */
public record ResolvedLlm(AiProviderType provider, LlmCredentials credentials, CredentialSource source) {
}
