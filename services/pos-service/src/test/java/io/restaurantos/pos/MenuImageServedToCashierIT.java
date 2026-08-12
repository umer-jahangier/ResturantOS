package io.restaurantos.pos;

import io.restaurantos.pos.dto.MenuCategoryAdminDtos.CreateMenuCategoryRequest;
import io.restaurantos.pos.dto.MenuCategoryDto;
import io.restaurantos.pos.dto.MenuItemAdminDtos.CreateMenuItemRequest;
import io.restaurantos.pos.dto.MenuItemDto;
import io.restaurantos.pos.feign.FileMetadataClient;
import io.restaurantos.pos.repository.MenuCategoryRepository;
import io.restaurantos.pos.repository.MenuItemRepository;
import io.restaurantos.pos.service.MenuService;
import io.restaurantos.pos.web.MenuController;
import io.restaurantos.shared.api.ApiResponse;
import io.restaurantos.shared.security.JwtClaims;
import io.restaurantos.shared.tenant.TenantContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.redis.core.ValueOperations;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.test.context.bean.override.mockito.MockitoBean;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * S7 — the cashier could not have been shown a menu picture even after the grid learned to draw
 * one, because the URL the grid was handed was not a URL the cashier may fetch.
 *
 * <h2>The measurement this file exists to keep true</h2>
 *
 * <p>Driven live on 2026-08-12 as {@code cashier@terrace.local}: the till listing returned two
 * items carrying {@code imageUrl}, and fetching that URL on the cashier's own bearer answered
 *
 * <pre>{@code {"error":{"code":"PERMISSION_DENIED",...}}}   403</pre>
 *
 * <p>because {@code /api/v1/files/{id}/download} is gated on {@code file.view}, which changeset
 * 082 grants to OWNER, TENANT_ADMIN, MANAGER, ACCOUNTANT and INVENTORY_MANAGER — and not to
 * CASHIER. The cashier's token carries fourteen permissions and not one of them starts with
 * {@code file.}.
 *
 * <p>The tempting repair was to add {@code ('CASHIER','file.view')} to that changeset. It would
 * have worked, and it would have handed every till in the estate a read of every document the
 * tenant stores — payroll files, contracts, supplier invoice scans — in order to show a
 * photograph of a curry. So the picture moved to the menu's own permission instead, and these
 * tests pin BOTH halves of that decision: the cashier can now read a picture that is on the menu
 * ({@link #cashierCanReadAPictureThatIsOnTheMenu}), and cannot read one that is not
 * ({@link #aFileNobodySMenuReferencesIsNotReachable}) — which is the whole reason this is not
 * just {@code file.view} under another name.
 */
class MenuImageServedToCashierIT extends PosTestBase {

    private static final byte[] PNG = {(byte) 0x89, 'P', 'N', 'G', 1, 2, 3, 4};

    @Autowired MenuController menuController;
    @Autowired MenuService menuService;
    @Autowired MenuItemRepository menuItemRepository;
    @Autowired MenuCategoryRepository menuCategoryRepository;
    @Autowired TenantContext tenantContext;

    /**
     * file-service is a different process. Mocked here so the test asserts pos-service's
     * AUTHORISATION decision — which is the thing that was wrong — rather than MinIO's health.
     */
    @MockitoBean FileMetadataClient fileMetadataClient;

    UUID tenantId;
    UUID branchId;
    UUID imageFileId;
    UUID itemId;

    @BeforeEach
    void setUp() {
        ValueOperations<String, String> valueOps = mock(ValueOperations.class);
        when(stringRedisTemplate.opsForValue()).thenReturn(valueOps);
        when(valueOps.get(anyString())).thenReturn("true");

        menuItemRepository.deleteAll();
        menuCategoryRepository.deleteAll();
        tenantId = UUID.randomUUID();
        branchId = UUID.randomUUID();
        imageFileId = UUID.randomUUID();
        tenantContext.set(tenantId, branchId, null, null);

        // The manager attaches the picture. requireValidImage crosses the same seam, so it is
        // stubbed to the answer a real PNG upload produces.
        when(fileMetadataClient.getMetadata(any(), any())).thenReturn(ApiResponse.ok(
                new FileMetadataClient.FileMetaDto(imageFileId, "karahi.png", "image/png",
                        PNG.length, "sha", "/api/v1/files/" + imageFileId + "/download",
                        Instant.now())));
        when(fileMetadataClient.getContent(any(), any())).thenReturn(ResponseEntity.ok()
                .header(HttpHeaders.CONTENT_TYPE, MediaType.IMAGE_PNG_VALUE)
                .body(PNG));

        authenticateAs(List.of("pos.menu.manage", "pos.menu.view"));
        MenuCategoryDto category = menuService.createCategory(
                new CreateMenuCategoryRequest("S7 Mains", "picture probe", 1, null));
        MenuItemDto item = menuService.createItem(new CreateMenuItemRequest(
                category.id(), "Chicken Karahi", "with a photograph",
                145_000L, null, null, imageFileId, null));
        itemId = item.id();
    }

    private void authenticateAs(List<String> permissions) {
        JwtClaims claims = new JwtClaims(
                UUID.randomUUID(), tenantId, branchId, List.of("CASHIER"), permissions, Map.of(), null);
        SecurityContextHolder.getContext().setAuthentication(
                new UsernamePasswordAuthenticationToken(
                        claims, null, permissions.stream().map(SimpleGrantedAuthority::new).toList()));
    }

    // ══ 1. The URL the till is handed is one the till's own persona may fetch ═════════════════

    @Test
    @DisplayName("the imageUrl on a menu item points at the menu's own route, not file-service's")
    void imageUrlPointsAtTheMenuRoute() {
        authenticateAs(List.of("pos.menu.view"));
        MenuItemDto item = menuService.getItem(itemId, branchId);

        assertThat(item.imageUrl())
                .as("the till was handed /api/v1/files/{id}/download, which its own cashier "
                        + "persona is answered 403 PERMISSION_DENIED on — measured 2026-08-12")
                .isEqualTo("/api/v1/pos/menu/images/" + imageFileId);
        assertThat(item.imageFileId())
                .as("the file id still round-trips, so an edit that changes only the price "
                        + "cannot silently drop the picture")
                .isEqualTo(imageFileId);
    }

    @Test
    @DisplayName("a cashier — holding pos.menu.view and no file.* code — gets the picture")
    void cashierCanReadAPictureThatIsOnTheMenu() {
        // Exactly the seeded CASHIER's menu authority. No file.view, deliberately: granting it
        // is the repair this whole endpoint exists to avoid.
        authenticateAs(List.of("pos.menu.view"));

        ResponseEntity<byte[]> response = menuController.menuImage(imageFileId);

        assertThat(response.getStatusCode().value()).isEqualTo(200);
        assertThat(response.getBody()).isEqualTo(PNG);
        assertThat(response.getHeaders().getContentType()).isEqualTo(MediaType.IMAGE_PNG);
        assertThat(response.getHeaders().getCacheControl())
                .as("the path is keyed by file id, so it changes when the photograph does — "
                        + "which is what makes immutable honest and stops a touchscreen "
                        + "re-fetching the whole grid on every category tap")
                .contains("immutable");
    }

    // ══ 2. …and it is NOT file.view under another name ════════════════════════════════════════

    @Test
    @DisplayName("a file no menu item references is not reachable, whoever asks")
    void aFileNobodySMenuReferencesIsNotReachable() {
        authenticateAs(List.of("pos.menu.view"));
        UUID payrollScan = UUID.randomUUID();

        ResponseEntity<byte[]> response = menuController.menuImage(payrollScan);

        assertThat(response.getStatusCode().value())
                .as("if this ever answers 200, the endpoint has become the tenant-wide file read "
                        + "it was built to avoid")
                .isEqualTo(404);
        verify(fileMetadataClient, never()).getContent(any(), eq(payrollScan));
    }

    @Test
    @DisplayName("another tenant's menu picture is not reachable with this tenant's rights")
    void anotherTenantsPictureIsNotReachable() {
        UUID otherTenant = UUID.randomUUID();
        UUID otherBranch = UUID.randomUUID();
        tenantContext.set(otherTenant, otherBranch, null, null);
        UUID theirTenantId = tenantId;
        tenantId = otherTenant;
        branchId = otherBranch;
        authenticateAs(List.of("pos.menu.view"));

        // Same file id, a neighbouring restaurant's rights. The picture belongs to the menu of
        // the tenant created in setUp(), and this caller is not that tenant.
        ResponseEntity<byte[]> response = menuController.menuImage(imageFileId);

        assertThat(response.getStatusCode().value()).isEqualTo(404);
        assertThat(theirTenantId).isNotEqualTo(otherTenant);
    }

    @Test
    @DisplayName("a principal with no menu permission at all is refused")
    void aPrincipalWithoutMenuViewIsRefused() {
        // A kitchen token: pos.kds.view / pos.kds.update and nothing about the menu.
        authenticateAs(List.of("pos.kds.view", "pos.kds.update"));

        assertThatThrownBy(() -> menuController.menuImage(imageFileId))
                .isInstanceOf(AccessDeniedException.class);
    }

    @Test
    @DisplayName("a picture file-service can no longer produce renders as absent, not as a fault")
    void anUnavailableFileDegradesToNoPicture() {
        when(fileMetadataClient.getContent(any(), any()))
                .thenThrow(new IllegalStateException("file-service is having an afternoon"));
        authenticateAs(List.of("pos.menu.view"));

        ResponseEntity<byte[]> response = menuController.menuImage(imageFileId);

        assertThat(response.getStatusCode().value())
                .as("a till mid-service must lose a photograph, never a tile")
                .isEqualTo(404);
    }
}
