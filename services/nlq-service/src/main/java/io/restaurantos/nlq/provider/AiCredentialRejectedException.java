package io.restaurantos.nlq.provider;

import io.restaurantos.nlq.claude.ClaudeUnavailableException;

/**
 * The AI provider REFUSED the credential (HTTP 401 / 403). Retrying will never fix it.
 *
 * <h3>Why it extends ClaudeUnavailableException</h3>
 *
 * <p>Every fail-closed path already written against {@code ClaudeUnavailableException} — the quota
 * rollback in {@code NlqService}, the audit-log row, the "no SQL was generated so nothing can
 * execute" guarantee — is correct for this case too. Subclassing inherits all of it instead of
 * duplicating it, and Spring's {@code @ExceptionHandler} resolution prefers the most specific
 * handler, so {@code NlqGlobalExceptionHandler} still gets to answer with a distinct code.
 *
 * <p>The difference that matters is what the human is told. A generic 503
 * <i>"temporarily unavailable"</i> invites the owner to wait; this one names the cause and points
 * at the screen that fixes it.
 *
 * <h3>What this exception must never carry</h3>
 *
 * <p>Not the API key, not the provider's raw response body. {@link #getMessage()} is a fixed safe
 * string. The only variable it carries is {@link #source()} — whose key was refused — because
 * "your key" and "the platform's key" need different remedies from different people.
 */
public class AiCredentialRejectedException extends ClaudeUnavailableException {

    /** Whose credential the provider refused. */
    public enum Source {
        /** The tenant's own saved key. An owner can replace it in Settings → AI. */
        TENANT,
        /** The platform's deploy-level key. Only an operator can fix this one. */
        PLATFORM
    }

    private final transient Source source;

    /**
     * Raised by an {@link LlmProvider}, which sees only an HTTP 401/403 and has no idea whose key
     * it sent — credentials arrive as a parameter. {@code source} is left null here and
     * {@code NlqLlmGateway} rethrows a stamped copy, because only the layer that performed the
     * resolution knows whether it handed over the tenant's key or the platform's.
     *
     * <p>Guessing a source in the provider would be worse than leaving it null: a wrong "TENANT"
     * would tell an owner to replace a key they never set, and a wrong "PLATFORM" would flip a
     * tenant's {@code key_state} on someone else's outage.
     */
    public AiCredentialRejectedException() {
        // Deliberately does NOT interpolate a status code, a body, or a key fragment.
        super("The AI provider refused the configured API credential");
        this.source = null;
    }

    /** Stamped by the resolution layer, which is the only place that knows whose key was sent. */
    public AiCredentialRejectedException(Source source) {
        super("The AI provider refused the configured API credential");
        this.source = source;
    }

    /** Whose key was refused, or null if this instance has not been stamped yet. */
    public Source source() {
        return source;
    }

    /** True when it is the tenant's own key that was refused — the only case a tenant can fix. */
    public boolean isTenantKey() {
        return source == Source.TENANT;
    }
}
