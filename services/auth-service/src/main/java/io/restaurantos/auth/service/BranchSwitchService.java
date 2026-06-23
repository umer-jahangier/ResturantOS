package io.restaurantos.auth.service;

import io.restaurantos.auth.dto.response.TokenResponse;
import io.restaurantos.auth.exception.BranchSwitchDeniedException;
import io.restaurantos.auth.repository.UserBranchRoleRepository;
import io.restaurantos.auth.config.AuthJwtProperties;
import io.restaurantos.shared.security.JwtClaims;
import io.restaurantos.shared.tenant.TenantContext;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.UUID;

@Service
public class BranchSwitchService {

    private final UserBranchRoleRepository userBranchRoleRepository;
    private final PermissionResolver permissionResolver;
    private final JwtSigningService jwtSigningService;
    private final AuthJwtProperties jwtProperties;
    private final TenantContext tenantContext;

    public BranchSwitchService(UserBranchRoleRepository userBranchRoleRepository,
                               PermissionResolver permissionResolver,
                               JwtSigningService jwtSigningService,
                               AuthJwtProperties jwtProperties,
                               TenantContext tenantContext) {
        this.userBranchRoleRepository = userBranchRoleRepository;
        this.permissionResolver = permissionResolver;
        this.jwtSigningService = jwtSigningService;
        this.jwtProperties = jwtProperties;
        this.tenantContext = tenantContext;
    }

    @Transactional(readOnly = true)
    public TokenResponse switchBranch(UUID targetBranchId) {
        JwtClaims claims = currentClaims();
        UUID userId = claims.subject();
        UUID tenantId = claims.tenantId();

        userBranchRoleRepository.findByUserIdAndBranchIdAndActiveTrue(userId, targetBranchId)
            .orElseThrow(() -> new BranchSwitchDeniedException("Branch not assigned to user"));

        ResolvedBranchAuth resolved = permissionResolver.resolve(userId, targetBranchId);
        JwtClaims newClaims = new JwtClaims(
            userId, tenantId, resolved.branchId(),
            resolved.roles(), resolved.permissions(), resolved.attributes(), null);
        String accessToken = jwtSigningService.signAccessToken(newClaims);
        return new TokenResponse(accessToken, jwtProperties.getAccessTtlSeconds());
    }

    private JwtClaims currentClaims() {
        Authentication auth = SecurityContextHolder.getContext().getAuthentication();
        if (auth == null || !(auth.getPrincipal() instanceof JwtClaims claims)) {
            throw new BranchSwitchDeniedException("Not authenticated");
        }
        tenantContext.set(claims.tenantId(), claims.branchId(), claims.subject(), claims.impersonatedBy());
        return claims;
    }
}
