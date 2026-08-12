package io.restaurantos.nlq.exception;

import io.restaurantos.nlq.claude.ClaudeUnavailableException;
import io.restaurantos.nlq.execution.NlqRowCapExceededException;
import io.restaurantos.nlq.execution.NlqTimeoutException;
import io.restaurantos.nlq.provider.AiCredentialRejectedException;
import io.restaurantos.nlq.quota.QuotaExceededException;
import io.restaurantos.nlq.quota.QuotaServiceUnavailableException;
import io.restaurantos.nlq.settings.AiCredentialStorageUnavailableException;
import io.restaurantos.nlq.settings.AiKeyRejectedAtSaveException;
import io.restaurantos.nlq.settings.AiNotConfiguredException;
import io.restaurantos.nlq.settings.AiSettingsProbeRateLimitedException;
import io.restaurantos.nlq.validation.NlqRejectedException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ProblemDetail;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

import java.net.URI;

/**
 * Maps every NLQ-specific exception to the HTTP status pinned in 12-07-SUMMARY.md for 12-09's
 * frontend to consume. Never echoes the offending SQL or a raw exception message that could leak
 * internals — {@link NlqRejectedException#getMessage()} is already a safe generic string by
 * construction (12-04).
 */
@RestControllerAdvice
public class NlqGlobalExceptionHandler {

    @ExceptionHandler(NlqRejectedException.class)
    public ResponseEntity<ProblemDetail> handleRejected(NlqRejectedException ex) {
        ProblemDetail pd = ProblemDetail.forStatusAndDetail(HttpStatus.BAD_REQUEST, ex.getMessage());
        pd.setTitle("QUERY_REJECTED");
        pd.setType(URI.create("urn:restaurantos:nlq:rejected"));
        pd.setProperty("code", ex.code().name());
        return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(pd);
    }

    @ExceptionHandler(QuotaExceededException.class)
    public ResponseEntity<ProblemDetail> handleQuotaExceeded(QuotaExceededException ex) {
        ProblemDetail pd = ProblemDetail.forStatusAndDetail(HttpStatus.TOO_MANY_REQUESTS, ex.getMessage());
        pd.setTitle("QUOTA_EXCEEDED");
        pd.setType(URI.create("urn:restaurantos:nlq:quota-exceeded"));
        pd.setProperty("code", "QUOTA_EXCEEDED_" + ex.quota().name());
        return ResponseEntity.status(HttpStatus.TOO_MANY_REQUESTS).body(pd);
    }

    @ExceptionHandler(QuotaServiceUnavailableException.class)
    public ResponseEntity<ProblemDetail> handleQuotaServiceUnavailable(QuotaServiceUnavailableException ex) {
        ProblemDetail pd = ProblemDetail.forStatusAndDetail(HttpStatus.SERVICE_UNAVAILABLE,
                "NLQ quota service is temporarily unavailable");
        pd.setTitle("QUOTA_SERVICE_UNAVAILABLE");
        pd.setType(URI.create("urn:restaurantos:nlq:quota-service-unavailable"));
        pd.setProperty("code", "QUOTA_SERVICE_UNAVAILABLE");
        return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE).body(pd);
    }

    /**
     * A WRONG API KEY IS NOT AN OUTAGE.
     *
     * <p>Before this handler existed, a 401 from the provider became
     * {@code CLAUDE_UNAVAILABLE} / "temporarily unavailable" — telling the owner to wait out a
     * condition that would never clear on its own. It never was a 500, but it was unactionable,
     * which is the defect the brief asks to close.
     *
     * <p><b>The status stays 503, and the actionability comes from the code and the copy.</b> The
     * gateway route and its {@code nlqCircuitBreaker} already carry 503 unchanged; putting a novel
     * status (502) through resilience4j on a live gateway buys nothing a distinct code does not
     * already give the frontend.
     *
     * <p>This handler must precede/override {@link #handleClaudeUnavailable} — it does, because
     * {@code AiCredentialRejectedException} is a subclass and Spring resolves the most specific
     * handler. Deleting it does not fail loudly; it silently re-collapses the two cases. That is
     * what {@code TenantAiSettingsIT.wrongKeyAtQueryTime…} exists to catch.
     */
    /**
     * The SAVE-time twin of {@link #handleCredentialRejected}: same fact, 400 instead of 503,
     * because the offending key is a field in the request the caller just sent and nothing was
     * persisted. Spring prefers this handler for the subclass.
     */
    @ExceptionHandler(AiKeyRejectedAtSaveException.class)
    public ResponseEntity<ProblemDetail> handleKeyRejectedAtSave(AiKeyRejectedAtSaveException ex) {
        ProblemDetail pd = ProblemDetail.forStatusAndDetail(HttpStatus.BAD_REQUEST,
                "The AI provider rejected this API key. Nothing was saved — check the key and try again.");
        pd.setTitle("AI_CREDENTIAL_REJECTED");
        pd.setType(URI.create("urn:restaurantos:nlq:ai-credential-rejected"));
        pd.setProperty("code", "AI_CREDENTIAL_REJECTED");
        return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(pd);
    }

    @ExceptionHandler(AiCredentialRejectedException.class)
    public ResponseEntity<ProblemDetail> handleCredentialRejected(AiCredentialRejectedException ex) {
        String detail = ex.isTenantKey()
                ? "The AI provider refused the API key saved for this restaurant. "
                  + "An owner can update it in Settings → AI."
                : "The AI provider refused the platform's API key. Please contact support.";
        ProblemDetail pd = ProblemDetail.forStatusAndDetail(HttpStatus.SERVICE_UNAVAILABLE, detail);
        pd.setTitle("AI_CREDENTIAL_REJECTED");
        pd.setType(URI.create("urn:restaurantos:nlq:ai-credential-rejected"));
        pd.setProperty("code", "AI_CREDENTIAL_REJECTED");
        // The source tells the frontend whether to offer "Go to Settings → AI" or "contact
        // support". It is an enum name, never anything key-derived.
        pd.setProperty("source", ex.source() == null ? null : ex.source().name());
        return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE).body(pd);
    }

    /** Nobody has supplied a key at all — neither the tenant nor the platform. */
    @ExceptionHandler(AiNotConfiguredException.class)
    public ResponseEntity<ProblemDetail> handleAiNotConfigured(AiNotConfiguredException ex) {
        ProblemDetail pd = ProblemDetail.forStatusAndDetail(HttpStatus.SERVICE_UNAVAILABLE,
                "No AI provider is configured for this restaurant. An owner can add an API key in "
                        + "Settings → AI.");
        pd.setTitle("AI_NOT_CONFIGURED");
        pd.setType(URI.create("urn:restaurantos:nlq:ai-not-configured"));
        pd.setProperty("code", "AI_NOT_CONFIGURED");
        return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE).body(pd);
    }

    /**
     * Field encryption is unset, or the stored ciphertext will not decrypt with the current key.
     *
     * <p>{@code ex.getMessage()} is deliberately NOT echoed: on the decrypt branch it wraps a
     * cipher failure whose detail is nobody's business outside this process. The fixed copy names
     * the environment variable an operator actually needs.
     */
    @ExceptionHandler(AiCredentialStorageUnavailableException.class)
    public ResponseEntity<ProblemDetail> handleStorageUnavailable(AiCredentialStorageUnavailableException ex) {
        ProblemDetail pd = ProblemDetail.forStatusAndDetail(HttpStatus.SERVICE_UNAVAILABLE,
                "Secure credential storage is not available on this server, so an AI key cannot be "
                        + "saved or read. An operator must configure FIELD_ENCRYPTION_KEY for nlq-service.");
        pd.setTitle("AI_CREDENTIAL_STORAGE_UNAVAILABLE");
        pd.setType(URI.create("urn:restaurantos:nlq:ai-credential-storage-unavailable"));
        pd.setProperty("code", "AI_CREDENTIAL_STORAGE_UNAVAILABLE");
        return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE).body(pd);
    }

    /** Too many key saves from one tenant in an hour — see {@code AiSettingsProbeRateLimiter}. */
    @ExceptionHandler(AiSettingsProbeRateLimitedException.class)
    public ResponseEntity<ProblemDetail> handleProbeRateLimited(AiSettingsProbeRateLimitedException ex) {
        ProblemDetail pd = ProblemDetail.forStatusAndDetail(HttpStatus.TOO_MANY_REQUESTS, ex.getMessage());
        pd.setTitle("AI_SETTINGS_RATE_LIMITED");
        pd.setType(URI.create("urn:restaurantos:nlq:ai-settings-rate-limited"));
        pd.setProperty("code", "AI_SETTINGS_RATE_LIMITED");
        return ResponseEntity.status(HttpStatus.TOO_MANY_REQUESTS).body(pd);
    }

    /** An unsupported provider string. 400, naming the field — not a 500. */
    @ExceptionHandler(IllegalArgumentException.class)
    public ResponseEntity<ProblemDetail> handleIllegalArgument(IllegalArgumentException ex) {
        ProblemDetail pd = ProblemDetail.forStatusAndDetail(HttpStatus.BAD_REQUEST, ex.getMessage());
        pd.setTitle("INVALID_REQUEST");
        pd.setType(URI.create("urn:restaurantos:nlq:invalid-request"));
        pd.setProperty("code", "INVALID_REQUEST");
        return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(pd);
    }

    @ExceptionHandler(ClaudeUnavailableException.class)
    public ResponseEntity<ProblemDetail> handleClaudeUnavailable(ClaudeUnavailableException ex) {
        ProblemDetail pd = ProblemDetail.forStatusAndDetail(HttpStatus.SERVICE_UNAVAILABLE,
                "The NLQ SQL-generation service is temporarily unavailable");
        pd.setTitle("CLAUDE_UNAVAILABLE");
        pd.setType(URI.create("urn:restaurantos:nlq:claude-unavailable"));
        pd.setProperty("code", "CLAUDE_UNAVAILABLE");
        return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE).body(pd);
    }

    @ExceptionHandler(NlqTimeoutException.class)
    public ResponseEntity<ProblemDetail> handleTimeout(NlqTimeoutException ex) {
        ProblemDetail pd = ProblemDetail.forStatusAndDetail(HttpStatus.BAD_REQUEST, ex.getMessage());
        pd.setTitle("QUERY_TIMEOUT");
        pd.setType(URI.create("urn:restaurantos:nlq:query-timeout"));
        pd.setProperty("code", "QUERY_TIMEOUT");
        return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(pd);
    }

    @ExceptionHandler(NlqRowCapExceededException.class)
    public ResponseEntity<ProblemDetail> handleRowCapExceeded(NlqRowCapExceededException ex) {
        ProblemDetail pd = ProblemDetail.forStatusAndDetail(HttpStatus.BAD_REQUEST, ex.getMessage());
        pd.setTitle("ROW_CAP_EXCEEDED");
        pd.setType(URI.create("urn:restaurantos:nlq:row-cap-exceeded"));
        pd.setProperty("code", "ROW_CAP_EXCEEDED");
        return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(pd);
    }
}
