package io.restaurantos.nlq.settings;

import io.restaurantos.nlq.provider.AiCredentialRejectedException;

/**
 * The provider refused the key the caller just submitted, during the save-time probe.
 *
 * <h3>Why a subclass instead of reusing the query-time exception</h3>
 *
 * <p>Same underlying fact, different HTTP semantics, because the caller's relationship to it is
 * different. At <b>query</b> time the key is stored server-side state that has gone bad — the
 * request itself was fine, so 503 with a distinct code. At <b>save</b> time the key is a field in
 * the request body the client just sent, and a bad field is a 400. Reporting "service unavailable"
 * to someone who has just pasted a typo would send them to check the provider's status page.
 *
 * <p>Spring resolves the most specific {@code @ExceptionHandler}, so this reaches its own 400
 * handler while remaining an {@code AiCredentialRejectedException} for any {@code catch} that
 * cares only that a credential was refused.
 *
 * <p><b>Nothing is persisted when this is thrown.</b> Storing a key the provider has already
 * rejected would put the tenant into a broken state that only surfaces at their next question.
 */
public class AiKeyRejectedAtSaveException extends AiCredentialRejectedException {

    public AiKeyRejectedAtSaveException() {
        super(Source.TENANT);
    }
}
