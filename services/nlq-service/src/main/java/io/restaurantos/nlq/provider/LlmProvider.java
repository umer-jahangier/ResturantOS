package io.restaurantos.nlq.provider;

/**
 * One AI provider's wire protocol, and nothing else.
 *
 * <p><b>What lives here:</b> how to turn a {@link LlmCall} into an HTTP request for this vendor,
 * and how to read the answer back out.
 *
 * <p><b>What deliberately does NOT live here:</b> prompt policy (the SQL system prompt, the
 * narrative prompt, token caps, markdown-fence stripping) and credential resolution. Those are NLQ
 * domain concerns owned by {@code NlqLlmGateway}. Keeping them out is what makes a second provider
 * a small addition rather than a fork of the whole pipeline.
 *
 * <h3>Failure contract — implementations MUST honour both branches</h3>
 * <ul>
 *   <li><b>401 / 403</b> → {@link AiCredentialRejectedException}. The credential is wrong. Retrying
 *       will never help, and the caller needs to say so to a human who can fix it.</li>
 *   <li><b>anything else</b> (5xx, timeout, network, malformed body) →
 *       {@link io.restaurantos.nlq.claude.ClaudeUnavailableException}. Transient; retry is
 *       reasonable.</li>
 * </ul>
 *
 * <p>Collapsing those two into one status is the defect this interface exists to prevent: before
 * this change, a wrong key produced <i>"the service is temporarily unavailable"</i>, telling the
 * owner to wait out a condition that would never clear on its own.
 *
 * <p>Implementations must never place the API key, or the provider's raw response body, into an
 * exception message or a log line.
 */
public interface LlmProvider {

    /** Which provider this implementation speaks for — the registry keys on it. */
    AiProviderType type();

    /**
     * @return the model's raw text, otherwise UNMODIFIED. Do not "clean up" the output here; that
     *         would create a false sense that a model's response is trustworthy.
     */
    String complete(LlmCredentials credentials, LlmCall call);
}
