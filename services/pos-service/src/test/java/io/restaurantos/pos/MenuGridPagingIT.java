package io.restaurantos.pos;

import io.restaurantos.pos.dto.MenuCategoryAdminDtos.CreateMenuCategoryRequest;
import io.restaurantos.pos.dto.MenuCategoryDto;
import io.restaurantos.pos.dto.MenuItemAdminDtos.CreateMenuItemRequest;
import io.restaurantos.pos.dto.MenuItemDto;
import io.restaurantos.pos.repository.MenuCategoryRepository;
import io.restaurantos.pos.repository.MenuItemRepository;
import io.restaurantos.pos.service.MenuService;
import io.restaurantos.pos.web.MenuController;
import io.restaurantos.shared.api.ApiResponse;
import io.restaurantos.shared.api.PageMeta;
import io.restaurantos.shared.security.JwtClaims;
import io.restaurantos.shared.tenant.TenantContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.redis.core.ValueOperations;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * S1-03: the till rendered the first 20 menu items and could not tell that more existed.
 *
 * <p>{@code GET /api/v1/pos/menu/items} takes a Spring {@code Pageable} (default page size 20)
 * and used to answer with {@code ApiResponse.ok(page.getContent())} — the rows and nothing else.
 * No total, no next cursor. A tenant with a 30-item menu got 20 tiles at the till and the product
 * had no way, anywhere, to say so; the missing ten were unsellable AND unsearchable, because the
 * till's search filters client-side over what was already fetched.
 *
 * <p>The category branch of {@code listItems} failed in the opposite direction and was just as
 * dishonest: it read every row and wrapped it in a {@code PageImpl} carrying the CALLER's page
 * size, so a 30-item category answered "page 0, size 20" with 30 rows and {@code hasNext=true} —
 * and page 1 returned the same 30 rows again. Any client that believed the metadata would have
 * shown the whole category twice. That is why this file asserts pages are DISJOINT, not merely
 * that everything eventually arrives.
 *
 * <p>Asserted at the controller, deliberately: the service always had a {@code Page} in its hands.
 * The controller is where the truncation became invisible, so the controller is where the
 * regression must be caught.
 */
class MenuGridPagingIT extends PosTestBase {

    /** More than one default page (20), and enough that a second page is non-trivially short. */
    private static final int ITEM_COUNT = 30;

    @Autowired MenuController menuController;
    @Autowired MenuService menuService;
    @Autowired MenuCategoryRepository menuCategoryRepository;
    @Autowired MenuItemRepository menuItemRepository;
    @Autowired TenantContext tenantContext;

    UUID tenantId;
    UUID branchId;
    UUID categoryId;

    @BeforeEach
    void setUp() {
        // MenuController is @RequiresFeature("FEATURE_POS"), and the gate reads its answer from
        // the (mocked) Redis cache. Left unstubbed, opsForValue() returns null and every
        // assertion below dies in the aspect without reaching the listing. Feature gating has its
        // own tests; here it is a precondition, so it is stubbed ON explicitly rather than
        // silently satisfied.
        ValueOperations<String, String> valueOps = mock(ValueOperations.class);
        when(stringRedisTemplate.opsForValue()).thenReturn(valueOps);
        when(valueOps.get(anyString())).thenReturn("true");

        // The Hibernate tenant filter only runs on the HTTP request path, and the Testcontainers
        // Postgres is a static singleton shared by every IT in the JVM — so without this the
        // uncategorised listing would also count another class's leftover rows and the totals
        // asserted below would be someone else's. Same note as MenuItemEventPublishingIT.
        menuItemRepository.deleteAll();
        menuCategoryRepository.deleteAll();
        tenantId = UUID.randomUUID();
        branchId = UUID.randomUUID();
        tenantContext.set(tenantId, branchId, null, null);

        authenticateAs(List.of("pos.menu.manage", "pos.menu.view"));
        MenuCategoryDto category = menuService.createCategory(
                new CreateMenuCategoryRequest("ZZ Paging", "S1-03 probe", 99, null));
        categoryId = category.id();
        for (int n = 1; n <= ITEM_COUNT; n++) {
            menuService.createItem(new CreateMenuItemRequest(
                    categoryId, String.format("ZZ-%02d", n), "paging probe " + n,
                    10_000L + n * 100L, null, null, null, null));
        }

        // The till is a cashier's screen: everything below is asserted with a cashier's authority.
        authenticateAs(List.of("pos.menu.view"));
    }

    /**
     * The GRANTED AUTHORITIES matter here, not just the claims: this file asserts through
     * {@code MenuController}, whose {@code @PreAuthorize("hasAuthority('pos.menu.view')")} is
     * enforced by the real method-security proxy. Handing the token an empty authority list — as
     * the service-level menu ITs do, because they are gated inside the service instead — makes
     * every assertion below fail with Access Denied rather than exercising the listing.
     */
    private void authenticateAs(List<String> permissions) {
        JwtClaims claims = new JwtClaims(
                UUID.randomUUID(), tenantId, branchId, List.of("CASHIER"), permissions, Map.of(), null);
        SecurityContextHolder.getContext().setAuthentication(
                new UsernamePasswordAuthenticationToken(
                        claims, null, permissions.stream().map(SimpleGrantedAuthority::new).toList()));
    }

    private ApiResponse<List<MenuItemDto>> page(UUID category, int number, int size) {
        return menuController.listItems(category, branchId, PageRequest.of(number, size)).getBody();
    }

    // ══ 1. A short answer must say that it is short ═══════════════════════════════════════════

    @Test
    @DisplayName("the uncategorised listing publishes the total it truncated against")
    void uncategorisedListingPublishesItsTotal() {
        ApiResponse<List<MenuItemDto>> response = page(null, 0, 20);

        assertThat(response.data()).hasSize(20);
        assertThat(response.meta())
                .as("20 of %d rows came back with no page metadata — the till cannot know it is "
                        + "short, which is the whole defect", ITEM_COUNT)
                .isNotNull();
        assertThat(response.meta().totalCount()).isEqualTo(ITEM_COUNT);
        assertThat(response.meta().page().nextCursor())
                .as("a next page exists and the response must name it")
                .isEqualTo("1");
        assertThat(response.meta().page().limit()).isEqualTo(20);
    }

    @Test
    @DisplayName("a category listing publishes the total it truncated against")
    void categoryListingPublishesItsTotal() {
        ApiResponse<List<MenuItemDto>> response = page(categoryId, 0, 20);

        assertThat(response.data()).hasSize(20);
        assertThat(response.meta()).isNotNull();
        assertThat(response.meta().totalCount()).isEqualTo(ITEM_COUNT);
        assertThat(response.meta().page().nextCursor()).isEqualTo("1");
    }

    // ══ 2. Following that metadata must reach every item, exactly once ════════════════════════

    @Test
    @DisplayName("paging the whole menu yields all 30 items with no duplicate and no gap")
    void pagingTheWholeMenuYieldsEveryItemOnce() {
        assertReachesEveryItemByPaging(null);
    }

    @Test
    @DisplayName("paging one category yields all 30 items with no duplicate and no gap")
    void pagingOneCategoryYieldsEveryItemOnce() {
        assertReachesEveryItemByPaging(categoryId);
    }

    private void assertReachesEveryItemByPaging(UUID category) {
        List<String> seen = new ArrayList<>();
        int number = 0;
        String next;
        do {
            ApiResponse<List<MenuItemDto>> response = page(category, number, 20);
            assertThat(response.meta()).isNotNull();
            response.data().forEach(item -> seen.add(item.name()));
            next = response.meta().page().nextCursor();
            number++;
        } while (next != null && number < 5);

        assertThat(seen)
                .as("page 1 repeated page 0 — the category branch ignored the Pageable and "
                        + "returned every row while still advertising a next page")
                .doesNotHaveDuplicates();
        assertThat(seen).hasSize(ITEM_COUNT);
        // ZZ-29 is the item the acceptance criterion searches for at the till. It sorts 29th of 30
        // by name, so it lands on the SECOND page — it is only reachable if paging really works.
        assertThat(seen).contains("ZZ-29", "ZZ-30", "ZZ-01");
    }

    // ══ 3. The last page must not claim a page after it ═══════════════════════════════════════

    @Test
    @DisplayName("the final page reports no next cursor, so a client knows when to stop")
    void finalPageReportsNoNextCursor() {
        ApiResponse<List<MenuItemDto>> last = page(categoryId, 1, 20);

        assertThat(last.data()).hasSize(ITEM_COUNT - 20);
        assertThat(last.meta().page().nextCursor()).isNull();
        assertThat(last.meta().totalCount()).isEqualTo(ITEM_COUNT);
    }

    // ══ 4. One request large enough for the whole menu returns the whole menu ═════════════════

    @Test
    @DisplayName("a size that covers the menu returns it entire, and says nothing follows")
    void aSizeThatCoversTheMenuReturnsItEntire() {
        ApiResponse<List<MenuItemDto>> response = page(null, 0, 200);

        assertThat(response.data()).hasSize(ITEM_COUNT);
        PageMeta meta = response.meta();
        assertThat(meta.totalCount()).isEqualTo(ITEM_COUNT);
        assertThat(meta.page().nextCursor()).isNull();
    }
}
