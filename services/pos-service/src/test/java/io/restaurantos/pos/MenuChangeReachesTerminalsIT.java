package io.restaurantos.pos;

import io.restaurantos.pos.domain.model.MenuCategory;
import io.restaurantos.pos.dto.MenuCategoryAdminDtos.CreateMenuCategoryRequest;
import io.restaurantos.pos.dto.MenuItemAdminDtos.CreateMenuItemRequest;
import io.restaurantos.pos.dto.MenuItemDto;
import io.restaurantos.pos.repository.MenuCategoryRepository;
import io.restaurantos.pos.repository.MenuItemRepository;
import io.restaurantos.pos.service.MenuService;
import io.restaurantos.pos.ws.MenuChangedFrame;
import io.restaurantos.pos.ws.PosOrderWebSocketHandler;
import io.restaurantos.shared.security.JwtClaims;
import io.restaurantos.shared.tenant.TenantContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.test.context.bean.override.mockito.MockitoBean;

import java.math.BigDecimal;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.clearInvocations;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;

/**
 * Register S1 #13 — "86 an item and have it disappear from the tills".
 *
 * <p>The gap was NEVER that the deactivation failed to persist; it always did, and a manual F5
 * on the till always showed it. The gap was that nothing told an already-open till. This file
 * pins the seam that was missing: every menu write that changes what a terminal may sell now
 * hands a {@link MenuChangedFrame} to the POS socket, so a till that is already open re-reads
 * the menu without anybody touching it.
 *
 * <p>Measured before the fix, in Chromium with two contexts side by side: manager deactivates
 * "Butter Naan"; the cashier's open till still showed it tappable at +2s, +5s, +10s and +20s
 * (40 tiles throughout) and dropped it only on a manual reload (39 tiles). Evidence:
 * {@code .planning/audits/repair/S1-08/before/}.
 *
 * <p>The handler is mocked here (same choice as {@code PosOrderWebSocketPushIT}) so the
 * assertion is on the notification contract; the socket-level fan-out and its tenant isolation
 * are proved separately, on a REAL handler with real sessions, in {@code ws/MenuLiveBroadcastTest}.
 */
class MenuChangeReachesTerminalsIT extends PosTestBase {

    @Autowired MenuService menuService;
    @Autowired MenuCategoryRepository menuCategoryRepository;
    @Autowired MenuItemRepository menuItemRepository;
    @Autowired TenantContext tenantContext;

    @MockitoBean PosOrderWebSocketHandler webSocketHandler;

    UUID tenantId;
    UUID branchId;
    UUID categoryId;

    @BeforeEach
    void setUp() {
        tenantId = UUID.randomUUID();
        branchId = UUID.randomUUID();
        tenantContext.set(tenantId, branchId, null, null);

        MenuCategory category = new MenuCategory();
        category.setTenantId(tenantId);
        category.setName("Breads-" + UUID.randomUUID());
        category.setSortOrder(1);
        categoryId = menuCategoryRepository.save(category).getId();

        // The service's write methods require pos.menu.manage; this IT calls them directly and
        // so has to populate what the HTTP filter chain normally would.
        JwtClaims claims = new JwtClaims(UUID.randomUUID(), tenantId, branchId,
                List.of("OWNER"), List.of("pos.menu.manage"), Map.of(), null);
        SecurityContextHolder.getContext().setAuthentication(
                new UsernamePasswordAuthenticationToken(claims, null, List.of()));
    }

    private MenuItemDto createNaan() {
        return menuService.createItem(new CreateMenuItemRequest(
                categoryId, "Butter Naan " + UUID.randomUUID(), "tandoori", 15000L,
                new BigDecimal("0.00"), null, null));
    }

    // ── THE gap ──────────────────────────────────────────────────────────────────────────────

    @Test
    void deactivatingAnItem_announcesItToEveryTerminalOfTheTenant() {
        MenuItemDto naan = createNaan();
        clearInvocations(webSocketHandler);

        menuService.setActive(naan.id(), false);

        ArgumentCaptor<MenuChangedFrame> captor = ArgumentCaptor.forClass(MenuChangedFrame.class);
        verify(webSocketHandler, times(1)).notifyMenuChanged(eq(tenantId), captor.capture());

        MenuChangedFrame frame = captor.getValue();
        assertThat(frame.event()).isEqualTo(MenuChangedFrame.EVENT);
        assertThat(frame.change()).isEqualTo(MenuChangedFrame.ITEM_DEACTIVATED);
        assertThat(frame.itemId()).isEqualTo(naan.id());
        assertThat(frame.active())
                .as("the terminal words its notice from this — announcing a deactivation with "
                        + "active=true would tell the cashier the opposite of what happened")
                .isFalse();
        assertThat(frame.itemName()).contains("Butter Naan");
    }

    @Test
    void reactivatingAnItem_announcesItToo() {
        MenuItemDto naan = createNaan();
        menuService.setActive(naan.id(), false);
        clearInvocations(webSocketHandler);

        menuService.setActive(naan.id(), true);

        ArgumentCaptor<MenuChangedFrame> captor = ArgumentCaptor.forClass(MenuChangedFrame.class);
        verify(webSocketHandler, times(1)).notifyMenuChanged(eq(tenantId), captor.capture());
        assertThat(captor.getValue().change()).isEqualTo(MenuChangedFrame.ITEM_ACTIVATED);
        assertThat(captor.getValue().active())
                .as("putting the item back on is half the feature — the kitchen finds more naan "
                        + "at 8pm and the tills have to be able to sell it again without an F5")
                .isTrue();
    }

    // ── The rest of the menu surface, so this does not become a one-endpoint special case ────

    @Test
    void creatingAnItem_announcesIt() {
        clearInvocations(webSocketHandler);
        createNaan();
        verify(webSocketHandler, times(1)).notifyMenuChanged(eq(tenantId), any());
    }

    @Test
    void deletingAnItem_announcesIt() {
        MenuItemDto naan = createNaan();
        clearInvocations(webSocketHandler);

        menuService.deleteItem(naan.id());

        ArgumentCaptor<MenuChangedFrame> captor = ArgumentCaptor.forClass(MenuChangedFrame.class);
        verify(webSocketHandler, times(1)).notifyMenuChanged(eq(tenantId), captor.capture());
        assertThat(captor.getValue().change()).isEqualTo(MenuChangedFrame.ITEM_DELETED);
    }

    @Test
    void deactivatingAWholeCategory_announcesIt() {
        var dessert = menuService.createCategory(new CreateMenuCategoryRequest("Desserts", "sweet", 9));
        clearInvocations(webSocketHandler);

        menuService.setCategoryActive(dessert.id(), false);

        ArgumentCaptor<MenuChangedFrame> captor = ArgumentCaptor.forClass(MenuChangedFrame.class);
        verify(webSocketHandler, times(1)).notifyMenuChanged(eq(tenantId), captor.capture());
        assertThat(captor.getValue().change())
                .as("'no desserts tonight' is the fastest 86 in the product and hides every item "
                        + "under it — if only item toggles announced, the till would keep offering "
                        + "a whole section that is gone")
                .isEqualTo(MenuChangedFrame.CATEGORY_CHANGED);
    }

    // ── The announcement must be a consequence of the COMMIT, not of the call ────────────────

    @Test
    void aFailedDeactivation_announcesNothing() {
        clearInvocations(webSocketHandler);

        assertThat(catchThrowable(() -> menuService.setActive(UUID.randomUUID(), false)))
                .as("the id does not exist, so nothing is written")
                .isNotNull();

        verify(webSocketHandler, times(0)).notifyMenuChanged(any(), any());
    }

    private static Throwable catchThrowable(Runnable r) {
        try {
            r.run();
            return null;
        } catch (Throwable t) {
            return t;
        }
    }
}
