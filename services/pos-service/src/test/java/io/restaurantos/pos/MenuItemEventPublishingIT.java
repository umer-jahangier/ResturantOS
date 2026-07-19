package io.restaurantos.pos;

import io.restaurantos.pos.domain.model.MenuCategory;
import io.restaurantos.pos.domain.model.MenuItem;
import io.restaurantos.pos.dto.MenuItemAdminDtos.CreateMenuItemRequest;
import io.restaurantos.pos.dto.MenuItemAdminDtos.UpdateMenuItemRequest;
import io.restaurantos.pos.dto.MenuItemDto;
import io.restaurantos.pos.repository.MenuCategoryRepository;
import io.restaurantos.pos.repository.MenuItemRepository;
import io.restaurantos.pos.service.MenuService;
import io.restaurantos.shared.event.OutboxRepository;
import io.restaurantos.shared.tenant.TenantContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import java.math.BigDecimal;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Proves every pos-service menu-item mutation (create/update/setActive/delete) emits the
 * correct MENU_ITEM_UPSERTED/MENU_ITEM_DELETED outbox row exactly once, that soft-delete never
 * physically removes the row, and that the D-05 republish backfill emits exactly one
 * MENU_ITEM_UPSERTED per currently-active item. Mirrors SettlementSemanticsIT's
 * OutboxRepository-autowired-and-queried-directly pattern.
 */
class MenuItemEventPublishingIT extends PosTestBase {

    @Autowired MenuService menuService;
    @Autowired MenuCategoryRepository menuCategoryRepository;
    @Autowired MenuItemRepository menuItemRepository;
    @Autowired OutboxRepository outboxRepository;
    @Autowired TenantContext tenantContext;

    UUID tenantId;
    UUID branchId;
    UUID categoryId;

    @BeforeEach
    void setUp() {
        outboxRepository.deleteAll();
        // The Hibernate tenantFilter is only enabled on the HTTP request path
        // (TenantFilterInterceptor); this IT calls MenuService directly, so without an
        // explicit cleanup, findByActiveTrueOrderByName() would also see rows left behind by
        // earlier test methods in this class (the Testcontainers Postgres instance is a static
        // singleton shared across all test methods — see PosTestBase). Scoped to this class only.
        menuItemRepository.deleteAll();
        menuCategoryRepository.deleteAll();
        tenantId = UUID.randomUUID();
        branchId = UUID.randomUUID();
        tenantContext.set(tenantId, branchId, null, null);

        MenuCategory category = new MenuCategory();
        category.setTenantId(tenantId);
        category.setName("Mains-" + UUID.randomUUID());
        category.setSortOrder(1);
        category = menuCategoryRepository.save(category);
        categoryId = category.getId();
    }

    private CreateMenuItemRequest newCreateRequest(String name) {
        return new CreateMenuItemRequest(categoryId, name, "desc", 15000L, new BigDecimal("5.00"), "STD");
    }

    private long countUpserted() {
        return outboxRepository.findAll().stream()
                .filter(e -> "MENU_ITEM_UPSERTED".equals(e.getEventType()))
                .count();
    }

    private long countDeleted() {
        return outboxRepository.findAll().stream()
                .filter(e -> "MENU_ITEM_DELETED".equals(e.getEventType()))
                .count();
    }

    @Test
    void createItem_publishesMenuItemUpserted() {
        menuService.createItem(newCreateRequest("Karahi"));

        assertThat(countUpserted()).isEqualTo(1);
    }

    @Test
    void updateItem_publishesAnotherUpserted() {
        MenuItemDto created = menuService.createItem(newCreateRequest("Karahi"));

        menuService.updateItem(created.id(),
                new UpdateMenuItemRequest(null, "Karahi Deluxe", "desc", 16000L, new BigDecimal("5.00"), "STD"));

        assertThat(countUpserted()).isEqualTo(2);
    }

    @Test
    void setActive_deactivate_publishesUpserted() {
        MenuItemDto created = menuService.createItem(newCreateRequest("Karahi"));

        menuService.setActive(created.id(), false);

        assertThat(countUpserted()).isEqualTo(2);
    }

    @Test
    void deleteItem_publishesMenuItemDeleted_softDeletesRow() {
        MenuItemDto created = menuService.createItem(newCreateRequest("Karahi"));

        menuService.deleteItem(created.id());

        assertThat(countDeleted()).isEqualTo(1);

        MenuItem persisted = menuItemRepository.findById(created.id()).orElseThrow();
        assertThat(persisted.getDeletedAt()).isNotNull();
        assertThat(persisted.isActive()).isFalse();
    }

    @Test
    void republishAllActive_emitsOneUpsertedPerActiveItem() {
        menuService.createItem(newCreateRequest("Karahi"));
        menuService.createItem(newCreateRequest("Biryani"));
        MenuItemDto toDeactivate = menuService.createItem(newCreateRequest("Nihari"));
        menuService.setActive(toDeactivate.id(), false);

        outboxRepository.deleteAll();

        int republished = menuService.republishAllActive();

        assertThat(republished).isEqualTo(2);
        assertThat(countUpserted()).isEqualTo(2);
    }
}
