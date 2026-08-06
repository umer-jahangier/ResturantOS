package io.restaurantos.user.client;

/**
 * An upstream service failed, or refused us for a reason the caller had no part in. Always surfaces
 * as {@code 502 UPSTREAM_ERROR} and never as a 4xx.
 *
 * <p><b>A 5xx must not become a 4xx.</b> Passing an upstream 500 through as a 400 would tell a
 * client their request was wrong when it was not — they would rewrite a correct request forever —
 * and it would hide a real outage from every 5xx alert in the platform. The same applies to the
 * refusals that are <em>our</em> fault rather than the caller's: a {@code 401} from
 * {@code /internal/auth/**} means user-service's shared secret is wrong, and a {@code 403
 * ACTING_USER_REQUIRED} means user-service failed to forward the caller's identity. Echoing either
 * would ask an authenticated tenant admin to log in again, or to obtain an authority, in response
 * to a misconfiguration they cannot see and cannot fix.
 *
 * <p>The client-facing message says nothing diagnostic on purpose. The detail — status, upstream
 * code, method key — is logged against the trace id instead.
 */
public class UpstreamServiceException extends RuntimeException {

    public UpstreamServiceException(String internalDetail) {
        super(internalDetail);
    }

    public UpstreamServiceException(String internalDetail, Throwable cause) {
        super(internalDetail, cause);
    }
}
