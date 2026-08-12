package io.restaurantos.auth.service;

import io.restaurantos.auth.dto.response.TokenResponse;
import io.restaurantos.auth.exception.BranchSwitchDeniedException;
import io.restaurantos.auth.repository.UserBranchRoleRepository;
import io.restaurantos.auth.config.AuthJwtProperties;
import io.restaurantos.shared.security.JwtClaims;
import io.restaurantos.shared.tenant.TenantContext;
import jakarta.persistence.EntityManager;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.UUID;

@Service
public class BranchSwitchService {

    private static final Logger log = LoggerFactory.getLogger(BranchSwitchService.class);

    private final UserBranchRoleRepository userBranchRoleRepository;
    private final PermissionResolver permissionResolver;
    private final JwtSigningService jwtSigningService;
    private final AuthJwtProperties jwtProperties;
    private final TenantContext tenantContext;
    private final EntityManager entityManager;
    private final RefreshSessionService refreshSessionService;

    public BranchSwitchService(UserBranchRoleRepository userBranchRoleRepository,
                               PermissionResolver permissionResolver,
                               JwtSigningService jwtSigningService,
                               AuthJwtProperties jwtProperties,
                               TenantContext tenantContext,
                               EntityManager entityManager,
                               RefreshSessionService refreshSessionService) {
        this.userBranchRoleRepository = userBranchRoleRepository;
        this.permissionResolver = permissionResolver;
        this.jwtSigningService = jwtSigningService;
        this.jwtProperties = jwtProperties;
        this.tenantContext = tenantContext;
        this.entityManager = entityManager;
        this.refreshSessionService = refreshSessionService;
    }

    /**
     * Switch the caller's active branch: reissue the access token AND move the session (S1-16).
     *
     * <h3>Why this method writes, and what happened while it did not</h3>
     *
     * <p>It used to be {@code readOnly}, and that was the whole defect. The access token it mints
     * lives in the SPA's memory only; a reload re-derives one from the refresh cookie, and
     * {@code AuthServiceImpl.refresh} resolves that token's branch from {@code refresh_sessions
     * .branch_id} — a column written once, at login. So a manager selected "Floating Terrace —
     * Rooftop", the label changed, the data reloaded, and the next F5 put them silently back on HQ
     * for the rest of the shift. Minting a token is only half a branch switch; the other half is
     * remembering it, and that is the write below.
     *
     * <p>The register recorded this as "the JWT branch claim never changed in either state". That
     * part is not true and was measured to be untrue before this fix: the switch response carried
     * the new {@code branch_id} correctly. It is the REFRESH that re-minted the old one.
     *
     * @param rawRefreshToken the {@code refresh_token} cookie sent with the switch, or {@code null}
     *                        if the caller presented none. The cookie's {@code Path=/api/v1/auth}
     *                        covers this endpoint, so a browser always sends it; a caller without one
     *                        holds no session to reload and therefore has nothing to persist.
     */
    @Transactional
    public TokenResponse switchBranch(UUID targetBranchId, String rawRefreshToken) {
        JwtClaims claims = currentClaims();
        UUID userId = claims.subject();
        UUID tenantId = claims.tenantId();
        setTenantGuc(tenantId);

        // A list, not an Optional: the Optional form threw IncorrectResultSizeDataAccessException
        // on a duplicated row, which turned "you have two roles here" into a 500 on a path whose
        // only two honest answers are a token or a 403.
        if (userBranchRoleRepository.findByUserIdAndBranchIdAndActiveTrue(userId, targetBranchId).isEmpty()) {
            throw new BranchSwitchDeniedException("Branch not assigned to user");
        }

        ResolvedBranchAuth resolved = permissionResolver.resolve(userId, targetBranchId);
        // Step-up carries across a branch switch. Unlike refresh, the caller is proving possession
        // of a live, signature-verified access token that already carries the marker — and anyone
        // holding that token can call the gated endpoint directly on the current branch anyway, so
        // dropping it here would buy no security and would break the ordinary "log in with a code,
        // switch to the branch whose payroll you are approving, approve" path.
        JwtClaims newClaims = new JwtClaims(
            userId, tenantId, resolved.branchId(),
            resolved.roles(), resolved.permissions(), resolved.attributes(), null,
            claims.totpVerified());
        String accessToken = jwtSigningService.signAccessToken(newClaims);

        // The half of the switch that outlives the token above. Ordered after the assignment check
        // on purpose: a denied switch throws before reaching here, so a 403 can never leave the
        // session pointing at a branch the user may not work on.
        boolean persisted = refreshSessionService.updateActiveBranch(
            rawRefreshToken, userId, resolved.branchId());
        if (!persisted) {
            // Not an error — an API client with no refresh session has no reload to survive — but
            // never silent either. If this appears for a browser session it means the switch will
            // evaporate on the next page load, which is the exact defect S1-16 recorded.
            log.warn("Branch switch for user {} to branch {} was not persisted to a refresh session"
                + " (refreshCookiePresent={}); it will not survive a page reload",
                userId, resolved.branchId(), rawRefreshToken != null && !rawRefreshToken.isBlank());
        }
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

    /** Sets the RLS tenant GUC inside the active transaction (matches AuthServiceImpl.login). */
    private void setTenantGuc(UUID tenantId) {
        entityManager.createNativeQuery("SELECT set_config('app.current_tenant_id', :tid, true)")
            .setParameter("tid", tenantId.toString())
            .getSingleResult();
    }
}
