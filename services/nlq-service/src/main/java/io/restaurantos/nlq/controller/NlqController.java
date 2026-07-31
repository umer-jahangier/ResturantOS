package io.restaurantos.nlq.controller;

import io.restaurantos.nlq.dto.NlqQueryRequest;
import io.restaurantos.nlq.dto.NlqQueryResponse;
import io.restaurantos.nlq.service.NlqService;
import io.restaurantos.nlq.validation.QueryContext;
import io.restaurantos.shared.api.ApiResponse;
import io.restaurantos.shared.security.JwtClaims;
import jakarta.validation.Valid;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * {@code POST /api/v1/nlq/query} — natural language in, rows + executed SQL + narrative out.
 *
 * <p>Every scoping value on {@link QueryContext} is derived from the VALIDATED JWT
 * ({@link JwtClaims}, set by {@code JwtAuthenticationFilter} — see {@code NlqSecurityConfig}),
 * never a client-supplied header or request field. In particular
 * {@code impersonatedBy = claims.impersonatedBy()} is NLQ-02's impersonation stamp — a
 * client-supplied header would be forgeable and therefore worthless as audit.
 */
@RestController
@RequestMapping("/api/v1/nlq")
public class NlqController {

    private final NlqService nlqService;

    public NlqController(NlqService nlqService) {
        this.nlqService = nlqService;
    }

    @PostMapping("/query")
    @PreAuthorize("hasAuthority('nlq.query.run')")
    public ApiResponse<NlqQueryResponse> query(@Valid @RequestBody NlqQueryRequest request,
                                                @AuthenticationPrincipal JwtClaims claims) {
        QueryContext ctx = buildContext(claims);
        return ApiResponse.ok(nlqService.query(request.question(), ctx));
    }

    private QueryContext buildContext(JwtClaims claims) {
        String roleCode = (claims.roles() == null || claims.roles().isEmpty()) ? null : claims.roles().get(0);
        boolean isOwner = "OWNER".equalsIgnoreCase(roleCode);
        return new QueryContext(claims.tenantId(), claims.branchId(), roleCode, isOwner,
                claims.subject(), claims.impersonatedBy());
    }
}
