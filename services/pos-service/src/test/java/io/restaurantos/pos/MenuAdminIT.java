package io.restaurantos.pos;

import io.restaurantos.pos.dto.MenuCategoryAdminDtos.CreateMenuCategoryRequest;
import io.restaurantos.pos.dto.MenuCategoryAdminDtos.UpdateMenuCategoryRequest;
import io.restaurantos.pos.dto.MenuCategoryDto;
import io.restaurantos.pos.dto.MenuItemAdminDtos.CreateMenuItemRequest;
import io.restaurantos.pos.dto.MenuItemDto;
import io.restaurantos.pos.repository.MenuCategoryRepository;
import io.restaurantos.pos.repository.MenuItemRepository;
import io.restaurantos.pos.service.MenuService;
import io.restaurantos.shared.event.OutboxRepository;
import io.restaurantos.shared.exception.PermissionDeniedException;
import io.restaurantos.shared.security.JwtClaims;
import io.restaurantos.shared.tenant.TenantContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;

import java.math.BigDecimal;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * Self-serve menu creation (this session's feature): pos-service already had a complete,
 * correct, event-publishing item CRUD API — nothing in the frontend ever called it, and menu
 * CATEGORIES had no create path anywhere (every tenant's categories were hand-inserted via
 * {@code scripts/seed_test_env.py}). Proves the new category create/deactivate/reactivate path,
 * the admin listings that include inactive rows (unlike the order-taking {@code listCategories}/
 * {@code listItems}, which must stay active-only), and the {@code pos.menu.manage} gate that
 * previously did not exist on ANY of this — before this change any POS user, including a
 * cashier, could call the write endpoints once a frontend existed.
 */
class MenuAdminIT extends PosTestBase {

    @Autowired MenuService menuService;
    @Autowired MenuCategoryRepository menuCategoryRepository;
    @Autowired MenuItemRepository menuItemRepository;
    @Autowired OutboxRepository outboxRepository;
    @Autowired TenantContext tenantContext;

    UUID tenantId;
    UUID branchId;

    @BeforeEach
    void setUp() {
        outboxRepository.deleteAll();
        // Same static-Testcontainers-singleton note as MenuItemEventPublishingIT: without this,
        // an admin listing in one test method would also see rows left behind by another.
        menuItemRepository.deleteAll();
        menuCategoryRepository.deleteAll();
        tenantId = UUID.randomUUID();
        branchId = UUID.randomUUID();
        tenantContext.set(tenantId, branchId, null, null);
        authenticateAs(List.of("pos.menu.manage"));
    }

    private void authenticateAs(List<String> permissions) {
        JwtClaims claims = new JwtClaims(
                UUID.randomUUID(), tenantId, branchId, List.of("OWNER"), permissions, Map.of(), null);
        SecurityContextHolder.getContext().setAuthentication(
                new UsernamePasswordAuthenticationToken(claims, null, List.of()));
    }

    // ── Category create/deactivate/reactivate ──────────────────────────────────────────────

    @Test
    void createCategory_appearsInBothTheLiveAndAdminListings() {
        MenuCategoryDto created = menuService.createCategory(
                new CreateMenuCategoryRequest("Starters", "Small plates", 1));

        assertThat(created.name()).isEqualTo("Starters");
        assertThat(created.active()).isTrue();
        assertThat(menuService.listCategories()).extracting(MenuCategoryDto::id).contains(created.id());
        assertThat(menuService.listCategoriesForAdmin()).extracting(MenuCategoryDto::id).contains(created.id());
    }

    @Test
    void deactivatingACategoryHidesItFromTheLiveListingButNotTheAdminOne() {
        MenuCategoryDto created = menuService.createCategory(
                new CreateMenuCategoryRequest("Seasonal", null, 2));

        MenuCategoryDto deactivated = menuService.setCategoryActive(created.id(), false);

        assertThat(deactivated.active()).isFalse();
        assertThat(menuService.listCategories()).extracting(MenuCategoryDto::id).doesNotContain(created.id());
        assertThat(menuService.listCategoriesForAdmin()).extracting(MenuCategoryDto::id).contains(created.id());
    }

    @Test
    void reactivatingACategoryBringsItBackToTheLiveListing() {
        MenuCategoryDto created = menuService.createCategory(new CreateMenuCategoryRequest("Drinks", null, 3));
        menuService.setCategoryActive(created.id(), false);

        MenuCategoryDto reactivated = menuService.setCategoryActive(created.id(), true);

        assertThat(reactivated.active()).isTrue();
        assertThat(menuService.listCategories()).extracting(MenuCategoryDto::id).contains(created.id());
    }

    @Test
    void updatingACategoryRenamesItWithoutTouchingActiveState() {
        MenuCategoryDto created = menuService.createCategory(new CreateMenuCategoryRequest("Beverages", "old", 4));

        MenuCategoryDto updated = menuService.updateCategory(created.id(),
                new UpdateMenuCategoryRequest("Drinks & Beverages", "new description", 5));

        assertThat(updated.name()).isEqualTo("Drinks & Beverages");
        assertThat(updated.description()).isEqualTo("new description");
        assertThat(updated.sortOrder()).isEqualTo(5);
        // Rename must not be a backdoor to flipping active state.
        assertThat(updated.active()).isTrue();
        assertThat(menuService.listCategories())
                .extracting(MenuCategoryDto::name)
                .contains("Drinks & Beverages")
                .doesNotContain("Beverages");
    }

    @Test
    void updatingACategoryWithoutPosMenuManageIsDenied() {
        MenuCategoryDto created = menuService.createCategory(new CreateMenuCategoryRequest("Mains", null, 1));
        authenticateAs(List.of("pos.order.view"));

        assertThatThrownBy(() -> menuService.updateCategory(created.id(),
                new UpdateMenuCategoryRequest("Renamed", null, 1)))
                .isInstanceOf(PermissionDeniedException.class);
    }

    // ── The gate that did not exist before this change ─────────────────────────────────────

    @Test
    void creatingACategoryWithoutPosMenuManageIsDenied() {
        authenticateAs(List.of("pos.order.view"));

        assertThatThrownBy(() -> menuService.createCategory(new CreateMenuCategoryRequest("Nope", null, 1)))
                .isInstanceOf(PermissionDeniedException.class);
    }

    @Test
    void creatingAnItemWithoutPosMenuManageIsDenied() {
        MenuCategoryDto category = menuService.createCategory(new CreateMenuCategoryRequest("Mains", null, 1));
        authenticateAs(List.of("pos.order.view"));

        assertThatThrownBy(() -> menuService.createItem(
                new CreateMenuItemRequest(category.id(), "Karahi", null, 15000L, null, null)))
                .isInstanceOf(PermissionDeniedException.class);
    }

    @Test
    void deactivatingAnItemWithoutPosMenuManageIsDenied() {
        authenticateAs(List.of("pos.menu.manage"));
        MenuCategoryDto category = menuService.createCategory(new CreateMenuCategoryRequest("Mains", null, 1));
        MenuItemDto item = menuService.createItem(
                new CreateMenuItemRequest(category.id(), "Karahi", null, 15000L, null, null));

        authenticateAs(List.of("pos.order.view"));

        assertThatThrownBy(() -> menuService.setActive(item.id(), false))
                .isInstanceOf(PermissionDeniedException.class);
    }

    // ── Admin item listing includes inactive, unlike the order-taking grid ─────────────────

    @Test
    void listItemsForAdmin_includesDeactivatedItemsScopedToOneCategory() {
        MenuCategoryDto category = menuService.createCategory(new CreateMenuCategoryRequest("Mains", null, 1));
        MenuItemDto live = menuService.createItem(
                new CreateMenuItemRequest(category.id(), "Karahi", null, 15000L, null, null));
        MenuItemDto toDeactivate = menuService.createItem(
                new CreateMenuItemRequest(category.id(), "Nihari", null, 18000L, null, null));
        menuService.setActive(toDeactivate.id(), false);

        List<MenuItemDto> adminList = menuService.listItemsForAdmin(category.id());

        assertThat(adminList).extracting(MenuItemDto::id).contains(live.id(), toDeactivate.id());
        // The order-taking listing must NOT regress — still active-only.
        assertThat(menuService.listItems(category.id(), null, org.springframework.data.domain.Pageable.unpaged())
                .getContent()).extracting(MenuItemDto::id).containsExactly(live.id());
    }

    // ── Creating a category, then an item under it, is the flow this feature exists for ────

    @Test
    void creatingACategoryThenAnItemUnderItIsOneCoherentFlow() {
        MenuCategoryDto category = menuService.createCategory(
                new CreateMenuCategoryRequest("New Arrivals", "Just added", 5));

        MenuItemDto item = menuService.createItem(new CreateMenuItemRequest(
                category.id(), "Chicken Karahi", "Spicy", 65000L, new BigDecimal("5.00"), "STD"));

        assertThat(item.categoryId()).isEqualTo(category.id());
        assertThat(item.categoryName()).isEqualTo("New Arrivals");
        // The same outbox write MenuItemEventPublishingIT proves — this is the seam
        // inventory-service's MenuItemCatalogConsumer picks up, which is what makes the item
        // choosable in the Recipe dialog once synced.
        assertThat(outboxRepository.findAll())
                .anyMatch(e -> "MENU_ITEM_UPSERTED".equals(e.getEventType()));
    }
}
