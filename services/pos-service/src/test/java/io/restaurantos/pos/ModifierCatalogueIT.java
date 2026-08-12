package io.restaurantos.pos;

import io.restaurantos.pos.domain.model.MenuCategory;
import io.restaurantos.pos.domain.model.MenuItem;
import io.restaurantos.pos.dto.AddOrderItemRequest;
import io.restaurantos.pos.dto.CreateOrderRequest;
import io.restaurantos.pos.dto.ModifierDtos.CreateModifierGroupRequest;
import io.restaurantos.pos.dto.ModifierDtos.CreateModifierRequest;
import io.restaurantos.pos.dto.ModifierDtos.ModifierGroupDto;
import io.restaurantos.pos.dto.ModifierDtos.ModifierOptionDto;
import io.restaurantos.pos.dto.ModifierDtos.UpdateModifierGroupRequest;
import io.restaurantos.pos.dto.OrderDto;
import io.restaurantos.pos.feign.FinancePeriodClient;
import io.restaurantos.pos.repository.MenuCategoryRepository;
import io.restaurantos.pos.repository.MenuItemRepository;
import io.restaurantos.pos.service.KitchenTicketAssembler;
import io.restaurantos.pos.service.ModifierCatalogueService;
import io.restaurantos.pos.service.OrderService;
import io.restaurantos.shared.api.ApiResponse;
import io.restaurantos.shared.exception.FieldValidationException;
import io.restaurantos.shared.exception.PermissionDeniedException;
import io.restaurantos.shared.print.PrintDocument;
import io.restaurantos.shared.security.JwtClaims;
import io.restaurantos.shared.tenant.TenantContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;

import java.math.BigDecimal;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;

/**
 * "No chilli", "extra cheese", "medium spicy" — the modifier catalogue, end to end (S6).
 *
 * <h2>The two defects this file exists to fail on</h2>
 *
 * <p><b>(1) The catalogue did not exist.</b> {@code Modifier.java} and {@code ModifierGroup.java}
 * had been JPA entities since V1 with no repository, no service and no route. Nothing could write
 * a row, so no cashier could ring a modifier and no owner could price one.
 *
 * <p><b>(2) And a modifier that DID reach an order printed as a UUID at zero price.</b>
 * {@code OrderServiceImpl.addItem} carried this, under the comment "for simplicity use a direct
 * lookup":
 *
 * <pre>
 *   oim.setModifierNameSnapshot(modifierId.toString());
 *   oim.setPriceDeltaPaisa(0L);
 * </pre>
 *
 * <p>There was no lookup. Both fields are PRINTED — {@code KitchenTicketAssembler} puts the name
 * snapshot on the chef's ticket and {@code ReceiptDocumentAssembler} puts it on the guest's bill —
 * and the delta feeds {@code OrderPricingCalculator.lineSubtotal}. So the kitchen was handed a hex
 * string and the restaurant gave the topping away.
 *
 * <h2>Falsification — how each test was watched to fail</h2>
 *
 * <p>Restore the two stub lines above in {@code addItem} (delete the
 * {@code modifierSelectionResolver.resolve(...)} loop and push {@code 0L} into
 * {@code modifierDeltas}) and re-run:
 *
 * <ul>
 *   <li>{@link #aChosenModifierIsPricedAndNamedOnTheLine} fails on the very first assertion —
 *       {@code modifierNameSnapshot} comes back as the option's UUID, not "Extra cheese".</li>
 *   <li>{@link #theLineTotalCarriesTheModifierDeltaToThePaisa} fails on {@code lineTotalPaisa},
 *       which stays at the bare dish price because every delta was zero.</li>
 *   <li>{@link #aForcedGroupRefusesTheLineUntilItIsAnswered} fails with NO exception at all —
 *       the stub validated nothing, so a check reached the pass with no spice level on it.</li>
 *   <li>{@link #anOptionFromAnotherDishIsRefused} and
 *       {@link #anOptionFromAnotherTenantIsRefused} fail the same way: the stub accepted any UUID
 *       whatsoever, including one that named nothing.</li>
 *   <li>{@link #theKitchenTicketPrintsTheModifierByName} fails with the ticket line reading a
 *       UUID — the exact string a chef was being handed.</li>
 * </ul>
 *
 * <p>The catalogue tests ({@link #aRetiredGroupStopsBeingARequirement} and the two bounds tests)
 * fail against the pre-S6 tree by not compiling: there was no service to call.
 */
class ModifierCatalogueIT extends PosTestBase {

    @Autowired OrderService orderService;
    @Autowired ModifierCatalogueService catalogue;
    @Autowired KitchenTicketAssembler kitchenTicketAssembler;
    @Autowired MenuItemRepository menuItemRepository;
    @Autowired MenuCategoryRepository menuCategoryRepository;
    @Autowired TenantContext tenantContext;
    @Autowired JdbcTemplate jdbcTemplate;

    UUID tenantId;
    UUID branchId;
    UUID userId;
    UUID karahiId;
    UUID naanId;

    /** Rs 850.00 a plate, zero-rated — so every figure below is checkable by hand. */
    private static final long KARAHI_PAISA = 85_000L;
    private static final long NAAN_PAISA = 5_000L;
    /** Rs 150.00 of extra cheese. */
    private static final long EXTRA_CHEESE_PAISA = 15_000L;

    UUID spiceGroupId;
    UUID mediumId;
    UUID hotId;
    UUID extrasGroupId;
    UUID extraCheeseId;
    UUID extraRaitaId;

    @BeforeEach
    void setUp() {
        tenantId = UUID.randomUUID();
        branchId = UUID.randomUUID();
        userId = UUID.randomUUID();
        tenantContext.set(tenantId, branchId, userId, null);
        asMenuManager();

        when(financePeriodClient.getPeriodStatus(any(), any(), any()))
                .thenReturn(new ApiResponse<>(
                        new FinancePeriodClient.PeriodStatusDto(UUID.randomUUID(), "OPEN", 2026, 8),
                        null, List.of()));

        MenuCategory cat = new MenuCategory();
        cat.setTenantId(tenantId);
        cat.setName("Mains-" + UUID.randomUUID());
        cat.setSortOrder(1);
        cat = menuCategoryRepository.save(cat);

        karahiId = saveItem(cat, "Chicken Karahi", KARAHI_PAISA);
        naanId = saveItem(cat, "Butter Naan", NAAN_PAISA);

        // "Spice level" — FORCED, choose exactly one. Both options free.
        ModifierGroupDto spice = catalogue.createGroup(karahiId,
                new CreateModifierGroupRequest("Spice level", true, 1, 1, 0));
        spiceGroupId = spice.id();
        mediumId = catalogue.createOption(spiceGroupId,
                new CreateModifierRequest("Medium", 0L, 0)).id();
        hotId = catalogue.createOption(spiceGroupId,
                new CreateModifierRequest("Hot", 0L, 1)).id();

        // "Extras" — OPTIONAL, up to 3, each priced.
        ModifierGroupDto extras = catalogue.createGroup(karahiId,
                new CreateModifierGroupRequest("Extras", false, 0, 3, 1));
        extrasGroupId = extras.id();
        extraCheeseId = catalogue.createOption(extrasGroupId,
                new CreateModifierRequest("Extra cheese", EXTRA_CHEESE_PAISA, 0)).id();
        extraRaitaId = catalogue.createOption(extrasGroupId,
                new CreateModifierRequest("Extra raita", 8_000L, 1)).id();

        asCashier();
        openTillForCashier(branchId);
    }

    private UUID saveItem(MenuCategory cat, String name, long pricePaisa) {
        MenuItem item = new MenuItem();
        item.setTenantId(tenantId);
        item.setCategory(cat);
        item.setName(name);
        item.setBasePricePaisa(pricePaisa);
        item.setTaxRatePct(new BigDecimal("0.00"));
        return menuItemRepository.save(item).getId();
    }

    private void asMenuManager() {
        setSecurityContext(userId, List.of("MANAGER"),
                List.of("pos.menu.view", "pos.menu.manage"));
    }

    private void asCashier() {
        setSecurityContext(userId, List.of("CASHIER"), List.of("pos.menu.view"));
    }

    private void setSecurityContext(UUID uid, List<String> roles, List<String> permissions) {
        JwtClaims claims = new JwtClaims(uid, tenantId, branchId, roles, permissions, Map.of(), null);
        SecurityContextHolder.getContext().setAuthentication(
                new UsernamePasswordAuthenticationToken(claims, null, List.of()));
        tenantContext.set(tenantId, branchId, uid, null);
    }

    private OrderDto newOrder() {
        return orderService.createOrder(
                new CreateOrderRequest(branchId, UUID.randomUUID(), null, null, 2, null, null));
    }

    // ── (1) the name and the price are REAL ───────────────────────────────────────────────

    /**
     * The defect, at the paisa. Medium (free) and Extra cheese (Rs 150.00) on one Karahi.
     *
     * <p>Both the DTO and the persisted row are read, because they are different failures: the DTO
     * is what the till and the charge screen show, the row is what the printed bill and the ledger
     * later read. The stub got both wrong and only the row is durable.
     */
    @Test
    void aChosenModifierIsPricedAndNamedOnTheLine() {
        OrderDto order = newOrder();
        OrderDto after = orderService.addItem(order.id(), new AddOrderItemRequest(
                karahiId, branchId, 1, List.of(mediumId, extraCheeseId), null));

        List<OrderDto.ModifierDto> mods = after.items().get(0).modifiers();
        assertThat(mods).hasSize(2);
        // Catalogue order, not tap order: Spice level sorts before Extras.
        assertThat(mods.get(0).modifierNameSnapshot()).isEqualTo("Medium");
        assertThat(mods.get(0).priceDeltaPaisa()).isZero();
        assertThat(mods.get(1).modifierNameSnapshot()).isEqualTo("Extra cheese");
        assertThat(mods.get(1).priceDeltaPaisa()).isEqualTo(EXTRA_CHEESE_PAISA);

        // Nothing on this line may be a UUID rendered as text — the whole shape of the defect.
        for (OrderDto.ModifierDto m : mods) {
            assertThat(m.modifierNameSnapshot())
                    .as("a modifier name that parses as a UUID is the stub, printed")
                    .doesNotMatch("[0-9a-fA-F-]{36}");
        }

        List<Map<String, Object>> rows = jdbcTemplate.queryForList("""
                SELECT oim.modifier_name_snapshot AS n, oim.price_delta_paisa AS d
                FROM order_item_modifiers oim
                JOIN order_items oi ON oi.id = oim.order_item_id
                WHERE oi.order_id = ?
                ORDER BY oim.price_delta_paisa ASC, oim.modifier_name_snapshot ASC
                """, order.id());
        assertThat(rows).hasSize(2);
        assertThat(rows.get(0).get("n")).isEqualTo("Medium");
        assertThat(((Number) rows.get(0).get("d")).longValue()).isZero();
        assertThat(rows.get(1).get("n")).isEqualTo("Extra cheese");
        assertThat(((Number) rows.get(1).get("d")).longValue()).isEqualTo(EXTRA_CHEESE_PAISA);
    }

    /**
     * The delta rides the UNIT price, so two plates of cheesy Karahi carry two lots of cheese.
     *
     * <p>Rs 850.00 + Rs 150.00 = Rs 1,000.00 a plate; × 2 = Rs 2,000.00. That is the arithmetic
     * {@code OrderPricingCalculator.lineSubtotal} has always done and that the stub fed zeroes to.
     */
    @Test
    void theLineTotalCarriesTheModifierDeltaToThePaisa() {
        OrderDto order = newOrder();
        OrderDto after = orderService.addItem(order.id(), new AddOrderItemRequest(
                karahiId, branchId, 2, List.of(hotId, extraCheeseId), null));

        long expected = (KARAHI_PAISA + EXTRA_CHEESE_PAISA) * 2;
        assertThat(after.items().get(0).lineTotalPaisa()).isEqualTo(expected);
        assertThat(after.subtotalPaisa()).isEqualTo(expected);
        assertThat(after.totalPaisa()).isEqualTo(expected);

        Map<String, Object> row = jdbcTemplate.queryForMap(
                "SELECT subtotal_paisa, total_paisa FROM orders WHERE id = ?", order.id());
        assertThat(((Number) row.get("subtotal_paisa")).longValue()).isEqualTo(expected);
        assertThat(((Number) row.get("total_paisa")).longValue()).isEqualTo(expected);
    }

    // ── (2) a forced group is genuinely forced, on the SERVER ─────────────────────────────

    /**
     * The dialog is how a cashier is stopped. This is what makes the rule true when the dialog is
     * bypassed — Quick Add, an offline till draining its outbox, or a direct call.
     */
    @Test
    void aForcedGroupRefusesTheLineUntilItIsAnswered() {
        OrderDto order = newOrder();

        assertThatThrownBy(() -> orderService.addItem(order.id(),
                new AddOrderItemRequest(karahiId, branchId, 1, null, null)))
                .isInstanceOf(FieldValidationException.class)
                .hasMessageContaining("Spice level")
                .hasMessageContaining("exactly 1 option");

        assertThatThrownBy(() -> orderService.addItem(order.id(),
                new AddOrderItemRequest(karahiId, branchId, 1, List.of(extraCheeseId), null)))
                .as("choosing an EXTRA does not answer the spice group")
                .isInstanceOf(FieldValidationException.class)
                .hasMessageContaining("Spice level");

        assertThat(jdbcTemplate.queryForObject(
                "SELECT count(*) FROM order_items WHERE order_id = ?", Long.class, order.id()))
                .as("a refused line must not have been written")
                .isZero();
    }

    /** Two spice levels on one plate is not a thing a kitchen can cook. */
    @Test
    void moreThanTheGroupMaximumIsRefused() {
        OrderDto order = newOrder();
        assertThatThrownBy(() -> orderService.addItem(order.id(),
                new AddOrderItemRequest(karahiId, branchId, 1, List.of(mediumId, hotId), null)))
                .isInstanceOf(FieldValidationException.class)
                .hasMessageContaining("Spice level")
                .hasMessageContaining("you have chosen 2");
    }

    /** A double-tap on the same option is a double charge, so it is refused by name. */
    @Test
    void theSameOptionTwiceIsRefused() {
        OrderDto order = newOrder();
        assertThatThrownBy(() -> orderService.addItem(order.id(), new AddOrderItemRequest(
                karahiId, branchId, 1, List.of(mediumId, extraCheeseId, extraCheeseId), null)))
                .isInstanceOf(FieldValidationException.class)
                .hasMessageContaining("Extra cheese")
                .hasMessageContaining("twice");
    }

    // ── (3) an id is not a licence ────────────────────────────────────────────────────────

    /** "Extra cheese" belongs to the Karahi. It is not orderable on a naan. */
    @Test
    void anOptionFromAnotherDishIsRefused() {
        OrderDto order = newOrder();
        assertThatThrownBy(() -> orderService.addItem(order.id(),
                new AddOrderItemRequest(naanId, branchId, 1, List.of(extraCheeseId), null)))
                .isInstanceOf(FieldValidationException.class)
                .hasMessageContaining("Butter Naan");
    }

    /**
     * The same reasoning that made {@code addItem} resolve {@code menuItemId} through a
     * tenant-scoped lookup rather than {@code findById}: a client-supplied id from another tenant
     * must be refused, not priced at that tenant's price.
     */
    @Test
    void anOptionFromAnotherTenantIsRefused() {
        UUID foreignOptionId = createForeignTenantOption();
        setSecurityContext(userId, List.of("CASHIER"), List.of("pos.menu.view"));
        OrderDto order = newOrder();

        assertThatThrownBy(() -> orderService.addItem(order.id(),
                new AddOrderItemRequest(karahiId, branchId, 1, List.of(mediumId, foreignOptionId), null)))
                .isInstanceOf(FieldValidationException.class)
                .hasMessageContaining("Chicken Karahi");
    }

    private UUID createForeignTenantOption() {
        UUID otherTenant = UUID.randomUUID();
        UUID otherUser = UUID.randomUUID();
        UUID otherBranch = UUID.randomUUID();
        JwtClaims claims = new JwtClaims(otherUser, otherTenant, otherBranch,
                List.of("MANAGER"), List.of("pos.menu.view", "pos.menu.manage"), Map.of(), null);
        SecurityContextHolder.getContext().setAuthentication(
                new UsernamePasswordAuthenticationToken(claims, null, List.of()));
        tenantContext.set(otherTenant, otherBranch, otherUser, null);

        MenuCategory cat = new MenuCategory();
        cat.setTenantId(otherTenant);
        cat.setName("Rival mains " + UUID.randomUUID());
        cat.setSortOrder(1);
        cat = menuCategoryRepository.save(cat);

        MenuItem item = new MenuItem();
        item.setTenantId(otherTenant);
        item.setCategory(cat);
        item.setName("Rival Karahi");
        item.setBasePricePaisa(1_000L);
        item.setTaxRatePct(new BigDecimal("0.00"));
        item = menuItemRepository.save(item);

        ModifierGroupDto group = catalogue.createGroup(item.getId(),
                new CreateModifierGroupRequest("Rival extras", false, 0, 3, 0));
        UUID optionId = catalogue.createOption(group.id(),
                new CreateModifierRequest("Free caviar", -500_000L, 0)).id();

        tenantContext.set(tenantId, branchId, userId, null);
        return optionId;
    }

    // ── (4) it reaches the pass by NAME ───────────────────────────────────────────────────

    /**
     * The chef's ticket. {@code KitchenTicketAssembler} has printed
     * {@code modifierNameSnapshot} since the day it was written — which is exactly why the stub
     * was so damaging: a UUID went to the pass and nobody could cook it.
     */
    @Test
    void theKitchenTicketPrintsTheModifierByName() {
        OrderDto order = newOrder();
        orderService.addItem(order.id(), new AddOrderItemRequest(
                karahiId, branchId, 1, List.of(hotId, extraCheeseId), null));
        OrderDto fired = orderService.sendToKds(order.id(), null);

        java.util.Set<UUID> firedItemIds = fired.items().stream()
                .map(OrderDto.OrderItemDto::id)
                .collect(java.util.stream.Collectors.toSet());
        List<KitchenTicketAssembler.StationTicket> tickets =
                kitchenTicketAssembler.assemble(fired.id(), branchId, 1, firedItemIds);
        assertThat(tickets).isNotEmpty();

        List<PrintDocument.Line> lines = tickets.stream()
                .flatMap(t -> t.document().lines().stream())
                .filter(l -> "Chicken Karahi".equals(l.name()))
                .toList();
        assertThat(lines).hasSize(1);
        assertThat(lines.get(0).modifiers()).containsExactly("Hot", "Extra cheese");
        for (String modifier : lines.get(0).modifiers()) {
            assertThat(modifier)
                    .as("the chef was being handed a hex string")
                    .doesNotMatch("[0-9a-fA-F-]{36}");
        }
    }

    // ── (5) catalogue rules ───────────────────────────────────────────────────────────────

    /**
     * Retiring a group must stop it being a requirement, or retiring "Spice level" would make the
     * dish unsellable — a catalogue edit that silently takes a dish off the menu.
     */
    @Test
    void aRetiredGroupStopsBeingARequirement() {
        asMenuManager();
        catalogue.updateGroup(spiceGroupId,
                new UpdateModifierGroupRequest("Spice level", true, 1, 1, 0, false));
        asCashier();

        OrderDto order = newOrder();
        OrderDto after = orderService.addItem(order.id(),
                new AddOrderItemRequest(karahiId, branchId, 1, null, null));
        assertThat(after.items()).hasSize(1);
        assertThat(after.items().get(0).modifiers()).isEmpty();
    }

    /** …but its options stop being orderable, and say so in those words. */
    @Test
    void aRetiredGroupsOptionsAreNoLongerOrderable() {
        asMenuManager();
        catalogue.updateGroup(spiceGroupId,
                new UpdateModifierGroupRequest("Spice level", true, 1, 1, 0, false));
        asCashier();

        OrderDto order = newOrder();
        assertThatThrownBy(() -> orderService.addItem(order.id(),
                new AddOrderItemRequest(karahiId, branchId, 1, List.of(hotId), null)))
                .isInstanceOf(FieldValidationException.class)
                .hasMessageContaining("no longer available");
    }

    /** "Choose exactly 2" over a group holding 2 options is fine; over 1 it is a dialog with no exit. */
    @Test
    void aMinimumBiggerThanTheGroupIsRefused() {
        asMenuManager();
        assertThatThrownBy(() -> catalogue.updateGroup(spiceGroupId,
                new UpdateModifierGroupRequest("Spice level", true, 3, 3, 0, true)))
                .isInstanceOf(FieldValidationException.class)
                .hasMessageContaining("holds 2 options");
    }

    /** {@code required} and {@code minSelect} are the same fact, so a contradiction is refused. */
    @Test
    void aForcedGroupWithAZeroMinimumIsRefused() {
        asMenuManager();
        assertThatThrownBy(() -> catalogue.createGroup(naanId,
                new CreateModifierGroupRequest("Cut", true, 0, 1, 0)))
                .isInstanceOf(FieldValidationException.class)
                .hasMessageContaining("at least one option");
    }

    /** A cashier reads the catalogue and cannot rewrite it. */
    @Test
    void aCashierCannotEditTheCatalogue() {
        asCashier();
        assertThat(catalogue.listForItem(karahiId)).hasSize(2);
        assertThatThrownBy(() -> catalogue.createGroup(karahiId,
                new CreateModifierGroupRequest("Free stuff", false, 0, 5, 0)))
                .isInstanceOf(PermissionDeniedException.class);
        assertThatThrownBy(() -> catalogue.createOption(extrasGroupId,
                new CreateModifierRequest("Free cheese", -EXTRA_CHEESE_PAISA, 0)))
                .isInstanceOf(PermissionDeniedException.class);
    }

    /** The till's ONE read: every active group in the tenant, options attached. */
    @Test
    void theTillReadsTheWholeCatalogueInOneCall() {
        asCashier();
        List<ModifierGroupDto> all = catalogue.listAllActive();
        assertThat(all).extracting(ModifierGroupDto::name)
                .containsExactly("Spice level", "Extras");
        assertThat(all.get(0).options()).extracting(ModifierOptionDto::name)
                .containsExactly("Medium", "Hot");
        assertThat(all.get(1).options()).extracting(ModifierOptionDto::priceDeltaPaisa)
                .containsExactly(EXTRA_CHEESE_PAISA, 8_000L);
        assertThat(all.get(0).menuItemId()).isEqualTo(karahiId);
        assertThat(all.get(0).required()).isTrue();
        assertThat(all.get(1).required()).isFalse();
        assertThat(all.get(1).maxSelect()).isEqualTo(3);
        assertThat(extraRaitaId).isNotNull();
    }
}
