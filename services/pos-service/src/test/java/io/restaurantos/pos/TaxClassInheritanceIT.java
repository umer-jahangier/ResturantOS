package io.restaurantos.pos;

import io.restaurantos.pos.dto.AddOrderItemRequest;
import io.restaurantos.pos.dto.CreateOrderRequest;
import io.restaurantos.pos.dto.MenuCategoryAdminDtos.CreateMenuCategoryRequest;
import io.restaurantos.pos.dto.MenuCategoryAdminDtos.UpdateMenuCategoryRequest;
import io.restaurantos.pos.dto.MenuCategoryDto;
import io.restaurantos.pos.dto.MenuItemAdminDtos.CreateMenuItemRequest;
import io.restaurantos.pos.dto.MenuItemAdminDtos.UpdateMenuItemRequest;
import io.restaurantos.pos.dto.MenuItemDto;
import io.restaurantos.pos.dto.OrderDto;
import io.restaurantos.pos.dto.TaxClassDtos.CreateTaxClassRequest;
import io.restaurantos.pos.dto.TaxClassDtos.TaxClassDto;
import io.restaurantos.pos.dto.TaxClassDtos.UpdateTaxClassRequest;
import io.restaurantos.pos.domain.enums.OrderType;
import io.restaurantos.pos.repository.MenuCategoryRepository;
import io.restaurantos.pos.repository.MenuItemRepository;
import io.restaurantos.pos.repository.TaxClassRepository;
import io.restaurantos.pos.service.MenuService;
import io.restaurantos.pos.service.OrderService;
import io.restaurantos.pos.service.TaxClassService;
import io.restaurantos.shared.exception.PermissionDeniedException;
import io.restaurantos.shared.exception.StateInvalidException;
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
 * F16 — a rate set once, in one place, reaching every dish that should carry it.
 *
 * <h2>What was actually broken</h2>
 *
 * <p>There was no sales-tax configuration anywhere in the product, and the consequence was in the
 * 2026-08-12 walkthrough's own bill: a Rs 1,657.00 dine-in subtotal taxed Rs 25.60 — 1.5% —
 * because two Butter Naans carried a per-item rate and no other line on the check carried
 * anything. Read live the same day: 40 menu items, 6 at 16.00%, 1 at 17.00%, 33 at zero.
 *
 * <h2>What these tests hold down</h2>
 *
 * <p>{@link #categoryClassReachesEveryItemIncludingOnesAddedLater} is the one that matters most,
 * and it is deliberately written so that a BULK-WRITE implementation passes the first half and
 * fails the second. "Apply the class to the category" has to mean INHERIT: a bulk write looks
 * identical the day it runs and silently un-taxes the next dish somebody adds — which is exactly
 * the defect above, re-committed by the product instead of by a gap in it.
 *
 * <p>{@link #ringingThreeItemsAcrossTwoRatesAgreesToThePaisa} rings the check from DONE MEANS and
 * asserts the order's own tax equals the sum computed line by line from the rates the resolver
 * chose — the identity the receipt assembler and the finance journal both depend on.
 *
 * <p>{@link #lineKeepsTheRateItWasRungAtAfterTheClassIsRerated} is the reason the snapshot columns
 * exist: before them the receipt re-read the live menu row at print time, so a reprint after a
 * rate change attributed old money to a new rate.
 */
class TaxClassInheritanceIT extends PosTestBase {

    @Autowired MenuService menuService;
    @Autowired TaxClassService taxClassService;
    @Autowired OrderService orderService;
    @Autowired MenuCategoryRepository menuCategoryRepository;
    @Autowired MenuItemRepository menuItemRepository;
    @Autowired TaxClassRepository taxClassRepository;
    @Autowired TenantContext tenantContext;

    UUID tenantId;
    UUID branchId;

    @BeforeEach
    void setUp() {
        menuItemRepository.deleteAll();
        menuCategoryRepository.deleteAll();
        taxClassRepository.deleteAll();
        tenantId = UUID.randomUUID();
        branchId = UUID.randomUUID();
        tenantContext.set(tenantId, branchId, null, null);
        authenticateAs(List.of("pos.menu.manage", "pos.menu.view", "pos.tax.manage",
                "pos.order.create", "pos.order.update"));
    }

    private void authenticateAs(List<String> permissions) {
        JwtClaims claims = new JwtClaims(
                UUID.randomUUID(), tenantId, branchId, List.of("OWNER"), permissions, Map.of(), null);
        SecurityContextHolder.getContext().setAuthentication(
                new UsernamePasswordAuthenticationToken(claims, null, List.of()));
    }

    private TaxClassDto standardRate() {
        return taxClassService.create(
                new CreateTaxClassRequest("SR-STD-17", "Standard rate", new BigDecimal("17.00")));
    }

    private TaxClassDto zeroRated() {
        return taxClassService.create(
                new CreateTaxClassRequest("ZR-EXEMPT", "Zero-rated", new BigDecimal("0.00")));
    }

    private MenuCategoryDto category(String name, UUID taxClassId) {
        return menuService.createCategory(new CreateMenuCategoryRequest(name, null, 1, taxClassId));
    }

    private MenuItemDto item(UUID categoryId, String name, long pricePaisa) {
        return menuService.createItem(new CreateMenuItemRequest(
                categoryId, name, null, pricePaisa, null, null, null, null));
    }

    // ── The rule, and the reason it is inheritance and not a bulk write ──────────────────────

    /**
     * THE test. A bulk-write implementation passes the first assertion and fails the second.
     */
    @Test
    void categoryClassReachesEveryItemIncludingOnesAddedLater() {
        TaxClassDto standard = standardRate();
        MenuCategoryDto mains = category("Mains", standard.id());

        MenuItemDto karahi = item(mains.id(), "Chicken Karahi", 95_000L);
        MenuItemDto biryani = item(mains.id(), "Mutton Biryani", 85_000L);

        assertThat(karahi.effectiveTaxRatePct()).isEqualByComparingTo("17.00");
        assertThat(karahi.effectiveTaxRateCode()).isEqualTo("SR-STD-17");
        assertThat(karahi.effectiveTaxLabel()).isEqualTo("Standard rate");
        assertThat(karahi.effectiveTaxSource()).isEqualTo("CATEGORY");
        assertThat(biryani.effectiveTaxRatePct()).isEqualByComparingTo("17.00");

        // Neither item carries the class on ITSELF. That is what makes it inheritance: the rule
        // lives on the category and the item is silent about tax.
        assertThat(karahi.taxClassId()).isNull();
        assertThat(biryani.taxClassId()).isNull();

        // The dish added AFTER the class was applied. A bulk write cannot reach this one, and it
        // is the dish a real restaurant adds on a Tuesday and discovers untaxed at year end.
        MenuItemDto addedLater = item(mains.id(), "Seekh Kebab", 60_000L);
        assertThat(addedLater.effectiveTaxRatePct()).isEqualByComparingTo("17.00");
        assertThat(addedLater.effectiveTaxSource()).isEqualTo("CATEGORY");
    }

    /** Applying the class to an EXISTING category reaches the items already under it. */
    @Test
    void applyingAClassToAnExistingCategoryReachesTheItemsAlreadyInIt() {
        MenuCategoryDto mains = category("Mains", null);
        MenuItemDto karahi = item(mains.id(), "Chicken Karahi", 95_000L);
        assertThat(karahi.effectiveTaxRatePct()).isEqualByComparingTo("0.00");
        assertThat(karahi.effectiveTaxSource()).isEqualTo("NONE");

        TaxClassDto standard = standardRate();
        menuService.updateCategory(mains.id(),
                new UpdateMenuCategoryRequest("Mains", null, 1, standard.id()));

        MenuItemDto reread = menuService.getItem(karahi.id(), null);
        assertThat(reread.effectiveTaxRatePct()).isEqualByComparingTo("17.00");
        assertThat(reread.effectiveTaxSource()).isEqualTo("CATEGORY");
    }

    // ── The exception ────────────────────────────────────────────────────────────────────────

    @Test
    void oneItemCanOverrideItsCategorysClassAndGoBack() {
        TaxClassDto standard = standardRate();
        TaxClassDto zero = zeroRated();
        MenuCategoryDto mains = category("Mains", standard.id());
        MenuItemDto naan = item(mains.id(), "Butter Naan", 12_000L);
        assertThat(naan.effectiveTaxRatePct()).isEqualByComparingTo("17.00");

        MenuItemDto overridden = menuService.updateItem(naan.id(), new UpdateMenuItemRequest(
                mains.id(), "Butter Naan", null, 12_000L, null, null, null, zero.id()));
        assertThat(overridden.taxClassId()).isEqualTo(zero.id());
        assertThat(overridden.effectiveTaxRatePct()).isEqualByComparingTo("0.00");
        assertThat(overridden.effectiveTaxRateCode()).isEqualTo("ZR-EXEMPT");
        assertThat(overridden.effectiveTaxSource()).isEqualTo("ITEM");

        // Its sibling is untouched — an override is an exception, not a category edit.
        MenuItemDto sibling = item(mains.id(), "Roghni Naan", 15_000L);
        assertThat(sibling.effectiveTaxRatePct()).isEqualByComparingTo("17.00");

        // And clearing the override puts it BACK on the category rule rather than zero-rating it.
        MenuItemDto cleared = menuService.updateItem(naan.id(), new UpdateMenuItemRequest(
                mains.id(), "Butter Naan", null, 12_000L, null, null, null, null));
        assertThat(cleared.taxClassId()).isNull();
        assertThat(cleared.effectiveTaxRatePct()).isEqualByComparingTo("17.00");
        assertThat(cleared.effectiveTaxSource()).isEqualTo("CATEGORY");
    }

    /**
     * The S0-03 regression, re-asserted under F16: a description-only edit must not disturb tax.
     *
     * <p>{@code MenuUpdateReplacesFieldsIT} pins the same property for the legacy columns. This
     * pins it for the class, because F16 added a fourth tax-shaped field to the same PUT and that
     * is precisely how the original bug got in.
     */
    @Test
    void editingOnlyTheDescriptionLeavesTheClassAndTheResolvedRateIntact() {
        TaxClassDto standard = standardRate();
        MenuCategoryDto mains = category("Mains", standard.id());
        TaxClassDto zero = zeroRated();
        MenuItemDto naan = menuService.updateItem(
                item(mains.id(), "Butter Naan", 12_000L).id(),
                new UpdateMenuItemRequest(mains.id(), "Butter Naan", null, 12_000L,
                        null, null, null, zero.id()));

        MenuItemDto edited = menuService.updateItem(naan.id(), new UpdateMenuItemRequest(
                mains.id(), "Butter Naan", "Now with garlic", 12_000L,
                // Every field round-tripped, as the PUT contract requires.
                naan.taxRatePct(), naan.taxRateCode(), naan.imageFileId(), naan.taxClassId()));

        assertThat(edited.description()).isEqualTo("Now with garlic");
        assertThat(edited.taxClassId()).isEqualTo(zero.id());
        assertThat(edited.effectiveTaxRateCode()).isEqualTo("ZR-EXEMPT");
        assertThat(edited.effectiveTaxRatePct()).isEqualByComparingTo("0.00");
    }

    // ── Back-compatibility: the data every tenant has today ─────────────────────────────────

    /**
     * An item with a legacy per-item rate and NO class keeps charging exactly what it charged
     * before F16. This is 40 of 40 rows in the live database on the day this ships.
     */
    @Test
    void aLegacyPerItemRateStillAppliesWhenNothingElseDoes() {
        MenuCategoryDto mains = category("Mains", null);
        MenuItemDto legacy = menuService.createItem(new CreateMenuItemRequest(
                mains.id(), "Chicken Samosa", null, 30_000L,
                new BigDecimal("16.00"), null, null, null));

        assertThat(legacy.effectiveTaxRatePct()).isEqualByComparingTo("16.00");
        assertThat(legacy.effectiveTaxSource()).isEqualTo("ITEM_CUSTOM");
        // No class, so nothing to name. The receipt renders "Tax" rather than an invented phrase.
        assertThat(legacy.effectiveTaxLabel()).isNull();
    }

    /** A category rule OUTRANKS a legacy per-item rate — that is what "apply to the menu" means. */
    @Test
    void aCategoryClassOutranksTheItemsLegacyRate() {
        TaxClassDto standard = standardRate();
        MenuCategoryDto mains = category("Mains", standard.id());
        MenuItemDto legacy = menuService.createItem(new CreateMenuItemRequest(
                mains.id(), "Chicken Samosa", null, 30_000L,
                new BigDecimal("16.00"), null, null, null));

        assertThat(legacy.effectiveTaxRatePct()).isEqualByComparingTo("17.00");
        assertThat(legacy.effectiveTaxSource()).isEqualTo("CATEGORY");
    }

    // ── The money ────────────────────────────────────────────────────────────────────────────

    /**
     * DONE MEANS: "ring a check of three items across two rates, and confirm the tax agrees to
     * the paisa".
     */
    @Test
    void ringingThreeItemsAcrossTwoRatesAgreesToThePaisa() {
        TaxClassDto standard = standardRate();
        TaxClassDto zero = zeroRated();
        MenuCategoryDto mains = category("Mains", standard.id());
        MenuCategoryDto drinks = category("Drinks", zero.id());

        MenuItemDto karahi = item(mains.id(), "Chicken Karahi", 95_000L);      // 17%
        MenuItemDto biryani = item(mains.id(), "Mutton Biryani", 85_000L);     // 17%
        MenuItemDto lime = item(drinks.id(), "Fresh Lime", 25_000L);           // 0%

        OrderDto order = orderService.createOrder(
                new CreateOrderRequest(branchId, UUID.randomUUID(), OrderType.DINE_IN, null, 2, null, null));
        orderService.addItem(order.id(), new AddOrderItemRequest(karahi.id(), branchId, 1, null, null));
        orderService.addItem(order.id(), new AddOrderItemRequest(biryani.id(), branchId, 2, null, null));
        order = orderService.addItem(order.id(), new AddOrderItemRequest(lime.id(), branchId, 1, null, null));

        // Computed here from first principles, not read back from the thing under test:
        //   Karahi   950.00 x 1 = 95_000 paisa @ 17% = 16_150
        //   Biryani  850.00 x 2 = 170_000 paisa @ 17% = 28_900
        //   Lime     250.00 x 1 = 25_000 paisa @  0% =      0
        assertThat(order.subtotalPaisa()).isEqualTo(290_000L);
        assertThat(order.taxPaisa()).isEqualTo(45_050L);
        assertThat(order.totalPaisa()).isEqualTo(335_050L);

        long lineTaxSum = order.items().stream().mapToLong(OrderDto.OrderItemDto::taxPaisa).sum();
        assertThat(lineTaxSum).isEqualTo(order.taxPaisa());

        // And every line carries the snapshot that lets the bill say WHICH rate it paid.
        OrderDto.OrderItemDto karahiLine = order.items().stream()
                .filter(i -> i.itemNameSnapshot().equals("Chicken Karahi")).findFirst().orElseThrow();
        assertThat(karahiLine.taxRatePct()).isEqualByComparingTo("17.00");
        assertThat(karahiLine.taxRateCode()).isEqualTo("SR-STD-17");
        assertThat(karahiLine.taxClassName()).isEqualTo("Standard rate");
        assertThat(karahiLine.taxPaisa()).isEqualTo(16_150L);
    }

    /** A rate change does not reach back into money already rung. */
    @Test
    void lineKeepsTheRateItWasRungAtAfterTheClassIsRerated() {
        TaxClassDto standard = standardRate();
        MenuCategoryDto mains = category("Mains", standard.id());
        MenuItemDto karahi = item(mains.id(), "Chicken Karahi", 100_000L);

        OrderDto order = orderService.createOrder(
                new CreateOrderRequest(branchId, UUID.randomUUID(), OrderType.TAKEAWAY, null, 1, null, null));
        order = orderService.addItem(order.id(), new AddOrderItemRequest(karahi.id(), branchId, 1, null, null));
        assertThat(order.taxPaisa()).isEqualTo(17_000L);

        taxClassService.update(standard.id(),
                new UpdateTaxClassRequest("SR-STD-17", "Standard rate", new BigDecimal("25.00"), true));

        OrderDto reread = orderService.getOrder(order.id(), branchId);
        assertThat(reread.taxPaisa()).isEqualTo(17_000L);
        assertThat(reread.items().get(0).taxRatePct()).isEqualByComparingTo("17.00");

        // The NEXT line rung does get the new rate.
        OrderDto second = orderService.createOrder(
                new CreateOrderRequest(branchId, UUID.randomUUID(), OrderType.TAKEAWAY, null, 1, null, null));
        second = orderService.addItem(second.id(), new AddOrderItemRequest(karahi.id(), branchId, 1, null, null));
        assertThat(second.taxPaisa()).isEqualTo(25_000L);
    }

    // ── The catalogue's own guards ───────────────────────────────────────────────────────────

    /** Removing a rate a menu is priced against would silently un-tax it. Refused, with counts. */
    @Test
    void aClassInUseCannotBeDeleted() {
        TaxClassDto standard = standardRate();
        MenuCategoryDto mains = category("Mains", standard.id());
        item(mains.id(), "Chicken Karahi", 95_000L);

        assertThatThrownBy(() -> taxClassService.delete(standard.id()))
                .isInstanceOf(StateInvalidException.class)
                .hasMessageContaining("Standard rate")
                .hasMessageContaining("1 categor");
    }

    /**
     * Deactivating is the supported way to retire a rate, and it must NOT change what the items
     * already on it are charged — otherwise "stop offering this" and "stop charging this" become
     * the same button.
     */
    @Test
    void deactivatingAClassLeavesTheItemsOnItStillCharged() {
        TaxClassDto standard = standardRate();
        MenuCategoryDto mains = category("Mains", standard.id());
        MenuItemDto karahi = item(mains.id(), "Chicken Karahi", 95_000L);

        taxClassService.update(standard.id(),
                new UpdateTaxClassRequest("SR-STD-17", "Standard rate", new BigDecimal("17.00"), false));

        MenuItemDto reread = menuService.getItem(karahi.id(), null);
        assertThat(reread.effectiveTaxRatePct()).isEqualByComparingTo("17.00");
    }

    /**
     * The permission split, executable. A MANAGER holds {@code pos.menu.manage} and may classify a
     * dish; deciding what "standard rate" MEANS is {@code pos.tax.manage}, held by OWNER and
     * TENANT_ADMIN. Without this test the split is a paragraph in a changeset.
     */
    @Test
    void menuManageCannotDefineARateButCanStillReadAndApplyOne() {
        TaxClassDto standard = standardRate();
        MenuCategoryDto mains = category("Mains", standard.id());

        authenticateAs(List.of("pos.menu.manage", "pos.menu.view"));

        assertThat(taxClassService.list()).extracting(TaxClassDto::code).contains("SR-STD-17");
        assertThat(menuService.createItem(new CreateMenuItemRequest(
                mains.id(), "Nihari", null, 70_000L, null, null, null, standard.id()))
                .effectiveTaxRatePct()).isEqualByComparingTo("17.00");

        assertThatThrownBy(() -> taxClassService.create(
                new CreateTaxClassRequest("XX-9", "Invented rate", new BigDecimal("9.00"))))
                .isInstanceOf(PermissionDeniedException.class)
                .hasMessageContaining("pos.tax.manage");
    }
}
