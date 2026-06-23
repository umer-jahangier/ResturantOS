package io.restaurantos.authz.service;

import io.restaurantos.authz.dto.request.AuthorizeRequest;
import io.restaurantos.authz.dto.response.AuthorizeResponse;
import io.restaurantos.shared.authz.OpaClient;
import io.restaurantos.shared.authz.OpaInput;
import io.restaurantos.shared.exception.PermissionDeniedException;
import io.restaurantos.shared.security.JwtClaims;
import org.springframework.stereotype.Service;

import java.time.Instant;

@Service
public class AuthorizeService {

    private final OpaClient opaClient;

    public AuthorizeService(OpaClient opaClient) {
        this.opaClient = opaClient;
    }

    public AuthorizeResponse authorize(AuthorizeRequest request, JwtClaims claims) {
        OpaInput input = OpaInput.builder()
            .user(new OpaInput.User(
                claims.subject(),
                claims.tenantId(),
                claims.branchId(),
                claims.permissions(),
                claims.attributes()))
            .resource(new OpaInput.Resource(
                request.resource().type(),
                request.resource().id(),
                request.resource().tenantId(),
                request.resource().branchId(),
                request.resource().createdBy(),
                request.resource().status(),
                request.resource().amountPaisa()))
            .action(request.action())
            .environment(new OpaInput.Environment(Instant.now(), null))
            .build();
        try {
            return new AuthorizeResponse(opaClient.evaluate(request.module(), input).allow());
        } catch (PermissionDeniedException e) {
            return new AuthorizeResponse(false);
        }
    }
}
