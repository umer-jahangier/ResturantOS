package io.restaurantos.authz.controller;

import io.restaurantos.authz.dto.request.AuthorizeRequest;
import io.restaurantos.authz.dto.response.AuthorizeResponse;
import io.restaurantos.authz.service.AuthorizeService;
import io.restaurantos.shared.api.ApiResponse;
import io.restaurantos.shared.security.JwtClaims;
import jakarta.validation.Valid;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/internal")
public class InternalAuthorizeController {

    private final AuthorizeService authorizeService;

    public InternalAuthorizeController(AuthorizeService authorizeService) {
        this.authorizeService = authorizeService;
    }

    @PostMapping("/authorize")
    public ResponseEntity<ApiResponse<AuthorizeResponse>> authorize(@Valid @RequestBody AuthorizeRequest request) {
        JwtClaims claims = (JwtClaims) SecurityContextHolder.getContext().getAuthentication().getPrincipal();
        AuthorizeResponse response = authorizeService.authorize(request, claims);
        return ResponseEntity.ok(ApiResponse.ok(response));
    }
}
