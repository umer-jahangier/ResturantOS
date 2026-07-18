package io.restaurantos.auth.service;

import io.restaurantos.auth.entity.UserEntity;
import io.restaurantos.auth.repository.UserRepository;
import jakarta.persistence.EntityManager;
import jakarta.persistence.Query;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InOrder;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.transaction.annotation.Transactional;

import java.lang.reflect.Method;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * Regression coverage for GAP C (12-14 / §1g): impersonate() 500'd because the RLS tenant GUC was
 * never set before the RLS-scoped users SELECT. Two complementary assertions are required:
 *
 * 1. Ordering — set_config(app.current_tenant_id, ...) MUST run before userRepository.findById.
 * 2. Transactional boundary — impersonate(...) MUST be @Transactional, otherwise the GUC (which is
 *    transaction-local: set_config(..., true)) and findById's SELECT can silently land on two
 *    different pooled connections (autocommit-per-statement), reproducing the exact bug this test
 *    exists to prevent. A mock-level InOrder check alone cannot detect a missing @Transactional —
 *    hence the explicit reflection assertion below.
 */
@ExtendWith(MockitoExtension.class)
class ProvisioningAdminServiceImpersonateTest {

    @Mock
    private UserRepository userRepository;
    @Mock
    private PasswordEncoder passwordEncoder;
    @Mock
    private PermissionResolver permissionResolver;
    @Mock
    private JwtSigningService jwtSigningService;
    @Mock
    private EntityManager entityManager;

    @Test
    void impersonate_isAnnotatedTransactional_greenIsImpossibleWithoutIt() throws NoSuchMethodException {
        Method impersonate = ProvisioningAdminService.class.getMethod(
            "impersonate", UUID.class, UUID.class, UUID.class, int.class);

        assertThat(impersonate.isAnnotationPresent(Transactional.class))
            .as("impersonate(...) must be @Transactional so the transaction-local set_config GUC "
                + "and the RLS-scoped findById share one connection (2099ac0 bug class)")
            .isTrue();
    }

    @Test
    void impersonate_setsTenantGuc_beforeFindById_andReturnsSignedToken() {
        UUID tenantId = UUID.fromString("a0000001-0000-4000-8000-000000000001");
        UUID targetUserId = UUID.fromString("c0000002-0000-4000-8000-000000000002");
        UUID impersonatedBy = UUID.fromString("ea07bc72-7c5c-4734-87d2-75ae388b5fd7");
        int ttlSeconds = 1800;

        Query gucQuery = mock(Query.class);
        when(entityManager.createNativeQuery(anyString())).thenReturn(gucQuery);
        when(gucQuery.setParameter(eq("tid"), anyString())).thenReturn(gucQuery);
        when(gucQuery.getSingleResult()).thenReturn(null);

        UserEntity target = new UserEntity();
        target.setId(targetUserId);
        target.setTenantId(tenantId);
        target.setEmail("target@example.com");
        target.setPasswordHash("hash");
        when(userRepository.findById(targetUserId)).thenReturn(Optional.of(target));

        ResolvedBranchAuth auth = new ResolvedBranchAuth(
            UUID.fromString("b0000001-0000-4000-8000-000000000001"),
            List.of("BRANCH_MANAGER"),
            List.of("orders:read"),
            Map.of());
        when(permissionResolver.resolveDefault(targetUserId)).thenReturn(auth);

        String signedToken = "signed.impersonation.jwt";

        // Stub using ArgumentMatchers.any() for the claims object (constructed inside the method).
        when(jwtSigningService.signImpersonationToken(
                org.mockito.ArgumentMatchers.any(),
                eq(impersonatedBy),
                eq(java.time.Duration.ofSeconds(ttlSeconds))))
            .thenReturn(signedToken);

        ProvisioningAdminService service = new ProvisioningAdminService(
            userRepository, passwordEncoder, permissionResolver, jwtSigningService, entityManager);

        ProvisioningAdminService.ImpersonateResult result =
            service.impersonate(tenantId, targetUserId, impersonatedBy, ttlSeconds);

        assertThat(result.token()).isEqualTo(signedToken);
        assertThat(result.expiresIn()).isEqualTo(ttlSeconds);

        // Ordering: the GUC native query must be created/parameterised BEFORE findById is invoked.
        InOrder inOrder = inOrder(entityManager, gucQuery, userRepository);
        inOrder.verify(entityManager).createNativeQuery(anyString());
        inOrder.verify(gucQuery).setParameter("tid", tenantId.toString());
        inOrder.verify(gucQuery).getSingleResult();
        inOrder.verify(userRepository).findById(targetUserId);
    }
}
