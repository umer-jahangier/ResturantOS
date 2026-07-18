package io.restaurantos.inventory;

import io.restaurantos.inventory.authz.InventoryAuthorizationService;
import io.restaurantos.shared.authz.AuthorizationService;
import io.restaurantos.shared.authz.OpaInput;
import io.restaurantos.shared.exception.PermissionDeniedException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.verify;

/**
 * Plain Mockito unit test for the inventory OPA seam — no Spring context, no dependency on
 * InventoryTestBase (must stay wave-2-independent from 08-02).
 */
@ExtendWith(MockitoExtension.class)
class InventoryAuthorizationServiceTest {

    @Mock
    private AuthorizationService authorizationService;

    private InventoryAuthorizationService inventoryAuthorizationService;

    @BeforeEach
    void setUp() {
        inventoryAuthorizationService = new InventoryAuthorizationService(authorizationService);
    }

    @Test
    void authorizeView_delegatesToSharedAuthorizationService_withInventoryModuleAndViewAction() {
        UUID tenantId = UUID.randomUUID();
        UUID branchId = UUID.randomUUID();

        inventoryAuthorizationService.authorizeView(tenantId, branchId);

        ArgumentCaptor<OpaInput.Resource> resourceCaptor = ArgumentCaptor.forClass(OpaInput.Resource.class);
        verify(authorizationService).authorize(
                org.mockito.ArgumentMatchers.eq("inventory"),
                org.mockito.ArgumentMatchers.eq("inventory.item.view"),
                resourceCaptor.capture());

        OpaInput.Resource resource = resourceCaptor.getValue();
        assertThat(resource.tenantId()).isEqualTo(tenantId);
        assertThat(resource.branchId()).isEqualTo(branchId);
    }

    @Test
    void authorizeManage_delegatesToSharedAuthorizationService_withInventoryModuleAndManageAction() {
        UUID tenantId = UUID.randomUUID();
        UUID branchId = UUID.randomUUID();

        inventoryAuthorizationService.authorizeManage(tenantId, branchId);

        ArgumentCaptor<OpaInput.Resource> resourceCaptor = ArgumentCaptor.forClass(OpaInput.Resource.class);
        verify(authorizationService).authorize(
                org.mockito.ArgumentMatchers.eq("inventory"),
                org.mockito.ArgumentMatchers.eq("inventory.item.manage"),
                resourceCaptor.capture());

        OpaInput.Resource resource = resourceCaptor.getValue();
        assertThat(resource.tenantId()).isEqualTo(tenantId);
        assertThat(resource.branchId()).isEqualTo(branchId);
    }

    @Test
    void authorizeManage_isFailClosed_rethrowsPermissionDeniedExceptionFromSharedService() {
        UUID tenantId = UUID.randomUUID();
        UUID branchId = UUID.randomUUID();

        doThrow(new PermissionDeniedException("Not permitted: inventory.inventory.item.manage"))
                .when(authorizationService)
                .authorize(
                        org.mockito.ArgumentMatchers.eq("inventory"),
                        org.mockito.ArgumentMatchers.eq("inventory.item.manage"),
                        org.mockito.ArgumentMatchers.any());

        assertThatThrownBy(() -> inventoryAuthorizationService.authorizeManage(tenantId, branchId))
                .isInstanceOf(PermissionDeniedException.class);
    }
}
