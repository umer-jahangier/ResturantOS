package io.restaurantos.shared.security;

import java.util.List;
import java.util.Map;
import java.util.UUID;

public record JwtClaims(UUID subject, UUID tenantId, UUID branchId,
                        List<String> roles, List<String> permissions,
                        Map<String, Object> attributes, UUID impersonatedBy) {
    /** Peek the 'kid' claim from the JWT header without validating the signature. */
    public static String peekKid(String token) {
        String headerJson = new String(java.util.Base64.getUrlDecoder().decode(token.substring(0, token.indexOf('.'))));
        int i = headerJson.indexOf("\"kid\":\"") + 7;
        return headerJson.substring(i, headerJson.indexOf('"', i));
    }
}
