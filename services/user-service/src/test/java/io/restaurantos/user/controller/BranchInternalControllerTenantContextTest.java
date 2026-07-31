package io.restaurantos.user.controller;

import io.restaurantos.shared.tenant.TenantContext;
import io.restaurantos.user.entity.BranchEntity;
import io.restaurantos.user.service.BranchService;
import jakarta.persistence.EntityManager;
import jakarta.persistence.Query;
import org.junit.jupiter.api.Test;
import org.springframework.http.ResponseEntity;

import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Pins the GAP B fix (12-13): getBranch must set the RLS tenant GUC from the forwarded JWT's
 * tenant claim (TenantContext) when the internal caller omits X-Tenant-Id, and must still prefer
 * an explicit X-Tenant-Id header when the caller sends one.
 *
 * Unit-level (mocked collaborators) — fast, no Spring context, no DB. The real-stack proof that
 * this closes the FBR ntn/fbrStrn NULL gap through the gateway is a separate task (Task 3).
 */
class BranchInternalControllerTenantContextTest {

    private final BranchService branchService = mock(BranchService.class);
    private final TenantContext tenantContext = mock(TenantContext.class);
    private final EntityManager entityManager = mock(EntityManager.class);
    private final Query query = mock(Query.class);

    private final BranchInternalController controller =
        new BranchInternalController(branchService, tenantContext, entityManager);

    @Test
    void getBranch_noHeader_fallsBackToJwtTenantClaim() {
        UUID branchId = UUID.randomUUID();
        UUID jwtTenant = UUID.randomUUID();
        BranchEntity branch = new BranchEntity();
        branch.setId(branchId);

        // Simulate JwtAuthenticationFilter having already populated TenantContext from the
        // forwarded caller JWT's tenant_id claim, before the controller runs.
        when(tenantContext.getTenantId()).thenReturn(Optional.of(jwtTenant));
        when(entityManager.createNativeQuery(anyString())).thenReturn(query);
        when(query.setParameter(anyString(), any())).thenReturn(query);
        when(query.getSingleResult()).thenReturn(1);
        when(branchService.get(branchId)).thenReturn(branch);

        ResponseEntity<BranchEntity> response = controller.getBranch(branchId, null);

        assertThat(response.getStatusCode().value()).isEqualTo(200);
        assertThat(response.getBody()).isSameAs(branch);

        // The GUC must have been set from the JWT-derived tenant (no header was sent) — this is
        // the exact fallback that closes the §1f "invalid input syntax for type uuid: ''" failure.
        verify(query).setParameter("tid", jwtTenant.toString());
        verify(tenantContext).set(eq(jwtTenant), any(), any(), any());
    }

    @Test
    void getBranch_withHeader_headerTakesPrecedenceOverJwtClaim() {
        UUID branchId = UUID.randomUUID();
        UUID headerTenant = UUID.randomUUID();
        UUID jwtTenant = UUID.randomUUID();
        BranchEntity branch = new BranchEntity();
        branch.setId(branchId);

        // TenantContext is populated with a DIFFERENT tenant than the explicit header — the
        // header must still win (back-compat with provisioning-saga callers that send it).
        when(tenantContext.getTenantId()).thenReturn(Optional.of(jwtTenant));
        when(entityManager.createNativeQuery(anyString())).thenReturn(query);
        when(query.setParameter(anyString(), any())).thenReturn(query);
        when(query.getSingleResult()).thenReturn(1);
        when(branchService.get(branchId)).thenReturn(branch);

        ResponseEntity<BranchEntity> response = controller.getBranch(branchId, headerTenant);

        assertThat(response.getStatusCode().value()).isEqualTo(200);
        verify(query).setParameter("tid", headerTenant.toString());
        verify(tenantContext).set(eq(headerTenant), any(), any(), any());
    }

    @Test
    void getBranch_noHeaderAndNoJwtTenant_skipsGucButStillCallsService() {
        // Guards the old behaviour for the case where neither source has a tenant (e.g. a
        // misconfigured caller) — no NPE, GUC simply isn't set, matching the prior semantics for
        // an absent header (previously the only lever available).
        UUID branchId = UUID.randomUUID();
        BranchEntity branch = new BranchEntity();
        branch.setId(branchId);

        when(tenantContext.getTenantId()).thenReturn(Optional.empty());
        when(branchService.get(branchId)).thenReturn(branch);

        ResponseEntity<BranchEntity> response = controller.getBranch(branchId, null);

        assertThat(response.getStatusCode().value()).isEqualTo(200);
        verify(entityManager, never()).createNativeQuery(anyString());
    }
}
