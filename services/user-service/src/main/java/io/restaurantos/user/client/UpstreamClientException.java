package io.restaurantos.user.client;

/**
 * An upstream service refused the request <em>on its merits</em> — the caller can fix it, or is
 * being told they may not do this. Carries the upstream status and error code through unchanged.
 *
 * <p>This exists because a refusal that arrives as a 500 is indistinguishable from a server fault.
 * 13-07 measured the consequence twice: {@code 400 UNKNOWN_ROLE_CODE} and (after 13-11 closed the
 * escalation) {@code 403 ROLE_CEILING_EXCEEDED} both reached the client as {@code 500
 * INTERNAL_ERROR}. A role picker cannot distinguish "you chose a role that does not exist" or "you
 * may not grant that" from "the platform broke", so it cannot say anything useful and a real
 * outage is buried in a 500 dashboard full of ordinary client mistakes.
 *
 * <p><b>Only the upstream's own structured {@code error.code} / {@code error.message} travel.</b>
 * The Feign exception's message — which names the internal host, port and path — and any stack
 * trace stay server-side. Those messages are written to be client-facing (the ceiling refusal names
 * the role and a permission <em>count</em>, deliberately not the permission codes), so passing them
 * through republishes nothing the upstream had not already decided to say.
 */
public class UpstreamClientException extends RuntimeException {

    private final int status;
    private final String code;

    public UpstreamClientException(int status, String code, String message) {
        super(message);
        this.status = status;
        this.code = code;
    }

    /** The upstream 4xx status, preserved verbatim. */
    public int status() {
        return status;
    }

    /** The upstream {@code error.code}, preserved verbatim. */
    public String code() {
        return code;
    }
}
