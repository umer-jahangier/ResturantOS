package io.restaurantos.shared.security;

import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * The identity carried by a validated access token.
 *
 * <p>{@code totpVerified} is the server's record that the login which minted this token actually
 * verified a TOTP code (see {@code AuthServiceImpl.enforceTotpStepUp}). It is the ONLY authority
 * for step-up-gated actions such as payroll approval and accounting-period close. It is never
 * derived from a request header: the gateway strips any inbound {@code X-TOTP-Verified} and
 * re-injects it from this claim, so a client cannot assert it.
 */
public record JwtClaims(UUID subject, UUID tenantId, UUID branchId,
                        List<String> roles, List<String> permissions,
                        Map<String, Object> attributes, UUID impersonatedBy,
                        boolean totpVerified) {

    /**
     * Claims for a token that performed NO TOTP step-up.
     *
     * <p>Deliberately fails closed: every call site that has no step-up signal to offer — service
     * tokens, impersonation, tests — gets {@code totpVerified=false} rather than a value it did
     * not mean to grant. Only a login that verified a code may use the canonical constructor with
     * {@code true}.
     */
    public JwtClaims(UUID subject, UUID tenantId, UUID branchId,
                     List<String> roles, List<String> permissions,
                     Map<String, Object> attributes, UUID impersonatedBy) {
        this(subject, tenantId, branchId, roles, permissions, attributes, impersonatedBy, false);
    }

    /** Peek the 'kid' claim from the JWT header without validating the signature. */
    public static String peekKid(String token) {
        String headerJson = new String(java.util.Base64.getUrlDecoder().decode(token.substring(0, token.indexOf('.'))));
        int i = headerJson.indexOf("\"kid\":\"") + 7;
        return headerJson.substring(i, headerJson.indexOf('"', i));
    }
}
