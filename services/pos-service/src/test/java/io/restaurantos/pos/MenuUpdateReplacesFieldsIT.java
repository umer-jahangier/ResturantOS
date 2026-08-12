package io.restaurantos.pos;

import io.restaurantos.pos.dto.MenuCategoryAdminDtos.CreateMenuCategoryRequest;
import io.restaurantos.pos.dto.MenuCategoryDto;
import io.restaurantos.pos.dto.MenuItemAdminDtos.CreateMenuItemRequest;
import io.restaurantos.pos.dto.MenuItemAdminDtos.UpdateMenuItemRequest;
import io.restaurantos.pos.dto.MenuItemDto;
import io.restaurantos.pos.repository.MenuCategoryRepository;
import io.restaurantos.pos.repository.MenuItemRepository;
import io.restaurantos.pos.service.MenuService;
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

/**
 * PUT /pos/menu/items/{id} is a REPLACE, and this pins what that means field by field.
 *
 * <p>Register S0 #4: an item seeded {@code taxRatePct=17.0, taxRateCode='SR-STD-17'} came out of
 * a description-only edit with {@code taxRateCode = null}. The endpoint was not wrong — the only
 * client omitted the key, and an omitted key IS a removal here. But the record carried three
 * fields with three different null meanings and a javadoc that documented one of them, so the
 * trap was invisible to whoever wrote that client.
 *
 * <p>These four tests make all three meanings executable, in both directions. Two of them exist
 * specifically to fail on the two tempting wrong fixes: null-guarding {@code taxRateCode} (which
 * would make a classification impossible to remove) and dropping the guard on
 * {@code taxRatePct} (which would let an old client zero a live tax rate by omission).
 */
class MenuUpdateReplacesFieldsIT extends PosTestBase {

    @Autowired MenuService menuService;
    @Autowired MenuCategoryRepository menuCategoryRepository;
    @Autowired MenuItemRepository menuItemRepository;
    @Autowired TenantContext tenantContext;

    UUID tenantId;
    UUID branchId;
    UUID categoryId;

    @BeforeEach
    void setUp() {
        menuItemRepository.deleteAll();
        menuCategoryRepository.deleteAll();
        tenantId = UUID.randomUUID();
        branchId = UUID.randomUUID();
        tenantContext.set(tenantId, branchId, null, null);
        JwtClaims claims = new JwtClaims(
                UUID.randomUUID(), tenantId, branchId, List.of("OWNER"),
                List.of("pos.menu.manage"), Map.of(), null);
        SecurityContextHolder.getContext().setAuthentication(
                new UsernamePasswordAuthenticationToken(claims, null, List.of()));
        MenuCategoryDto category = menuService.createCategory(
                new CreateMenuCategoryRequest("Starters", null, 1));
        categoryId = category.id();
    }

    /** A classified item exactly as the register's evidence describes it. */
    private MenuItemDto seededTaxedItem() {
        return menuService.createItem(new CreateMenuItemRequest(
                categoryId, "Seekh Kebab", "Seekh Kebab — Floating Terrace", 45000L,
                new BigDecimal("17.00"), "SR-STD-17", null));
    }

    @Test
    void anEditThatRoundTripsTheTaxCodeKeepsTheFiscalClassification() {
        MenuItemDto seeded = seededTaxedItem();
        assertThat(seeded.taxRateCode()).isEqualTo("SR-STD-17");

        // What a correct client sends to change only the description: EVERY field, including the
        // two it is not changing. This is the shape the frontend's updateMenuItemInputSchema now
        // makes mandatory rather than merely conventional.
        MenuItemDto updated = menuService.updateItem(seeded.id(), new UpdateMenuItemRequest(
                categoryId, "Seekh Kebab", "Seekh Kebab — typo fixed", 45000L,
                new BigDecimal("17.00"), "SR-STD-17", null));

        assertThat(updated.description()).isEqualTo("Seekh Kebab — typo fixed");
        assertThat(updated.taxRateCode()).isEqualTo("SR-STD-17");
        assertThat(updated.taxRatePct()).isEqualByComparingTo("17.00");
        // Read back from the row, not from the returned DTO — a DTO can echo an input the
        // database never took.
        assertThat(menuItemRepository.findById(seeded.id()).orElseThrow().getTaxRateCode())
                .isEqualTo("SR-STD-17");
    }

    @Test
    void clearingTheTaxCodeOnPurposeStillRemovesIt() {
        MenuItemDto seeded = seededTaxedItem();

        MenuItemDto updated = menuService.updateItem(seeded.id(), new UpdateMenuItemRequest(
                categoryId, "Seekh Kebab", "Seekh Kebab — Floating Terrace", 45000L,
                new BigDecimal("17.00"), null, null));

        // The other half of the contract. A fix that made the code un-erasable would be a
        // different defect, not a repair — an item CAN legitimately stop being classified.
        assertThat(updated.taxRateCode()).isNull();
        assertThat(menuItemRepository.findById(seeded.id()).orElseThrow().getTaxRateCode()).isNull();
        // Removing the classification must not disturb the rate that is actually charged.
        assertThat(updated.taxRatePct()).isEqualByComparingTo("17.00");
    }

    @Test
    void omittingTheTaxRateLeavesItUnchanged() {
        MenuItemDto seeded = seededTaxedItem();

        MenuItemDto updated = menuService.updateItem(seeded.id(), new UpdateMenuItemRequest(
                categoryId, "Seekh Kebab", "Seekh Kebab — Floating Terrace", 45000L,
                null, "SR-STD-17", null));

        // taxRatePct is the LEAVE-UNCHANGED group. This is what saved the rate from the S0 #4
        // wipe while the code beside it was destroyed, and removing this guard would turn every
        // omission into a zero-rating — a money defect, so it is pinned here.
        assertThat(updated.taxRatePct()).isEqualByComparingTo("17.00");
        assertThat(menuItemRepository.findById(seeded.id()).orElseThrow().getTaxRatePct())
                .isEqualByComparingTo("17.00");
    }

    @Test
    void theRegistersOwnPayloadIsStillAWipe_whichIsWhyEveryFieldMustBeSent() {
        MenuItemDto seeded = seededTaxedItem();

        // Byte for byte the body the browser used to send: {categoryId, name, description,
        // basePricePaisa, imageFileId}. It removes the code, by design — REMOVE-on-absent is the
        // documented semantics of this endpoint and this test says so out loud, so that nobody
        // "fixes" S0 #4 here and leaves clients unable to clear a classification at all.
        MenuItemDto updated = menuService.updateItem(seeded.id(), new UpdateMenuItemRequest(
                categoryId, "Seekh Kebab", "Seekh Kebab — typo fixed", 45000L, null, null, null));

        assertThat(updated.taxRateCode()).isNull();
        assertThat(updated.taxRatePct()).isEqualByComparingTo("17.00");
    }
}
