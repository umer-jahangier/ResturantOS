package io.restaurantos.purchasing;

import io.restaurantos.purchasing.domain.enums.PoStatus;
import io.restaurantos.purchasing.domain.model.PurchaseOrder;
import io.restaurantos.purchasing.domain.model.PurchaseOrderLine;
import io.restaurantos.purchasing.domain.model.Vendor;
import io.restaurantos.purchasing.domain.model.VendorItem;
import io.restaurantos.purchasing.dto.CreatePurchaseOrderRequest;
import io.restaurantos.purchasing.dto.MockReceiveRequest;
import io.restaurantos.purchasing.exception.IngredientNotInTenantException;
import io.restaurantos.purchasing.exception.PackUomInvalidException;
import io.restaurantos.purchasing.feign.InventoryCategoryClient;
import io.restaurantos.purchasing.feign.InventoryUomClient;
import io.restaurantos.purchasing.repository.MockGrnReceiptRepository;
import io.restaurantos.purchasing.repository.PurchaseOrderRepository;
import io.restaurantos.purchasing.repository.VendorItemRepository;
import io.restaurantos.purchasing.repository.VendorRepository;
import io.restaurantos.purchasing.service.GrnReceiptSimulator;
import io.restaurantos.purchasing.service.PurchaseOrderService;
import io.restaurantos.shared.tenant.TenantContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;

import java.math.BigDecimal;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.Mockito.when;

/**
 * A purchase-order line that inventory could not honour is refused where a human can still fix it.
 *
 * <p><b>The two defects, both measured on the live stack in plan 36-01 and both reported as
 * successes at every step:</b>
 *
 * <ul>
 *   <li><b>F-31-02.</b> A line naming a freshly generated UUID was accepted, submitted, approved,
 *       sent and received; the order closed {@code FULLY_RECEIVED} with zero stock rows, zero
 *       inventory movements and zero journal entries, and the message dead-lettered ~20s later into
 *       a queue with no consumer and no monitor.</li>
 *   <li><b>F-31-03.</b> A line whose unit was {@code FURLONG} was accepted, and seven furlongs
 *       became seven kilograms of Basmati Rice.</li>
 * </ul>
 *
 * <p><b>Why this class turns validation back on.</b> {@code PurchasingTestBase} sets
 * {@code validate-references=false} because that context genuinely has no inventory-service. This
 * test has a stubbed one, so it opts back in — which is the whole point of 36-04's split: the check
 * is now governed by its own property rather than by whether goods receipts are simulated.
 *
 * <p>Run with failsafe: {@code mvn -pl services/purchasing-service verify -Dit.test=PoLineValidityGateIT}.
 * {@code mvn test -Dtest=...IT} executes zero tests and reports success.
 */
@TestPropertySource(properties = "restaurantos.inventory.validate-references=true")
@DisplayName("A PO line inventory could not honour is refused at creation and at receipt")
class PoLineValidityGateIT extends PurchasingTestBase {

    @MockitoBean
    private InventoryCategoryClient inventoryCategoryClient;

    @MockitoBean
    private InventoryUomClient inventoryUomClient;

    @Autowired private PurchaseOrderService purchaseOrderService;
    @Autowired private GrnReceiptSimulator grnReceiptSimulator;
    @Autowired private PurchaseOrderRepository purchaseOrderRepository;
    @Autowired private VendorRepository vendorRepository;
    @Autowired private VendorItemRepository vendorItemRepository;
    @Autowired private MockGrnReceiptRepository mockGrnReceiptRepository;
    @Autowired private TenantContext tenantContext;

    private static final UUID TENANT = UUID.fromString("a0000001-0000-4000-8000-000000000001");
    private static final UUID BRANCH = UUID.fromString("b0000001-0000-4000-8000-000000000001");
    /** An ingredient inventory DOES have. */
    private static final UUID REAL_INGREDIENT = UUID.fromString("11111111-1111-4111-8111-111111111111");
    /** The shape of F-31-02: an id inventory has never seen. */
    private static final UUID GHOST_INGREDIENT = UUID.fromString("22222222-2222-4222-8222-222222222222");

    private UUID vendorId;

    @BeforeEach
    void setUp() {
        tenantContext.set(TENANT, BRANCH, UUID.randomUUID(), null);

        // The internal category lookup answers for EVERY requested id; a real in-tenant ingredient
        // carries a non-null categoryId (ingredients have a NOT NULL category FK), an unknown or
        // foreign one comes back null. That presence is the existence-and-ownership signal.
        when(inventoryCategoryClient.getIngredientCategories(anyList())).thenAnswer(invocation -> {
            List<UUID> ids = invocation.getArgument(0);
            return ids.stream()
                    .map(id -> new InventoryCategoryClient.IngredientCategoryResponse(
                            id,
                            REAL_INGREDIENT.equals(id) ? UUID.randomUUID() : null,
                            REAL_INGREDIENT.equals(id) ? "Raw Materials" : "Uncategorized",
                            null))
                    .toList();
        });

        // The tenant's unit registry. Mixed case on purpose — codes have never been normalised at
        // rest, and the comparison must not care.
        when(inventoryUomClient.listUomCodes(any())).thenReturn(List.of("KG", "G", "EACH", "l"));

        Vendor vendor = new Vendor();
        vendor.setTenantId(TENANT);
        vendor.setName("Gate Test Vendor");
        vendor.setPaymentTerms("NET30");
        vendor.setActive(true);
        vendorId = vendorRepository.save(vendor).getId();
    }

    private CreatePurchaseOrderRequest handTyped(UUID ingredientId, String uom) {
        return new CreatePurchaseOrderRequest(vendorId, BRANCH, null, "gate test",
                List.of(new CreatePurchaseOrderRequest.Line(null, ingredientId, BigDecimal.valueOf(3), uom, 100000L)));
    }

    private UUID catalogItem(UUID ingredientId, String packUom) {
        VendorItem item = new VendorItem();
        item.setTenantId(TENANT);
        item.setVendorId(vendorId);
        item.setIngredientId(ingredientId);
        // Unique per row: uq_vendor_item_tenant_vendor_sku is UNIQUE NULLS NOT DISTINCT, so two
        // rows with a null sku collide.
        item.setVendorSku("SKU-" + UUID.randomUUID());
        item.setOrderUom("CASE");           // the outer unit the PRICE is quoted in
        item.setPackQty(BigDecimal.valueOf(10));
        item.setPackUom(packUom);           // the unit that actually TRAVELS on the receipt
        item.setPackUnitsPerOrderUnit(BigDecimal.valueOf(10));
        return vendorItemRepository.save(item).getId();
    }

    // ── Creation ────────────────────────────────────────────────────────────────────────────

    @Test
    @DisplayName("a hand-typed line naming an ingredient the tenant does not have is refused, by id")
    void handTypedGhostIngredientIsRefused() {
        long before = purchaseOrderRepository.count();

        assertThatThrownBy(() -> purchaseOrderService.create(handTyped(GHOST_INGREDIENT, "KG")))
                .isInstanceOf(IngredientNotInTenantException.class)
                .hasMessageContaining(GHOST_INGREDIENT.toString())
                .hasMessageContaining("not in this tenant's inventory");

        // A refusal writes NOTHING. Reporting success and producing nothing is the defect; so is
        // reporting failure and leaving a row.
        assertThat(purchaseOrderRepository.count())
                .as("a refused create must leave no purchase order behind")
                .isEqualTo(before);
    }

    @Test
    @DisplayName("a CATALOG line is checked against the vendor item's pack unit, not the order unit")
    void catalogLineIsCheckedOnThePackUomThatTravels() {
        // orderUom is CASE — which is NOT in the registry and must NOT be what is checked, because
        // it is not what inventory ever sees. packUom is what travels.
        UUID goodItem = catalogItem(REAL_INGREDIENT, "G");
        CreatePurchaseOrderRequest ok = new CreatePurchaseOrderRequest(vendorId, BRANCH, null, "catalog ok",
                List.of(new CreatePurchaseOrderRequest.Line(goodItem, null, BigDecimal.ONE, null, 620000L)));
        assertThatCode(() -> purchaseOrderService.create(ok))
                .as("orderUom 'CASE' is not in the registry, but it never travels — this must pass")
                .doesNotThrowAnyException();

        UUID badItem = catalogItem(REAL_INGREDIENT, "FURLONG");
        CreatePurchaseOrderRequest bad = new CreatePurchaseOrderRequest(vendorId, BRANCH, null, "catalog bad",
                List.of(new CreatePurchaseOrderRequest.Line(badItem, null, BigDecimal.ONE, null, 620000L)));
        assertThatThrownBy(() -> purchaseOrderService.create(bad))
                .isInstanceOf(PackUomInvalidException.class)
                .hasMessageContaining("FURLONG");
    }

    @Test
    @DisplayName("a catalog row that outlived the ingredient it references is refused too")
    void catalogLinePointingAtAGoneIngredientIsRefused() {
        UUID staleItem = catalogItem(GHOST_INGREDIENT, "KG");
        CreatePurchaseOrderRequest req = new CreatePurchaseOrderRequest(vendorId, BRANCH, null, "stale catalog",
                List.of(new CreatePurchaseOrderRequest.Line(staleItem, null, BigDecimal.ONE, null, 100000L)));

        assertThatThrownBy(() -> purchaseOrderService.create(req))
                .isInstanceOf(IngredientNotInTenantException.class)
                .hasMessageContaining(GHOST_INGREDIENT.toString());
    }

    @Test
    @DisplayName("a unit the registry does not define is refused, and the message says what would work")
    void unknownUnitIsRefusedAndNamesTheAlternatives() {
        assertThatThrownBy(() -> purchaseOrderService.create(handTyped(REAL_INGREDIENT, "FURLONG")))
                .isInstanceOf(PackUomInvalidException.class)
                .hasMessageContaining("FURLONG")
                .hasMessageContaining("KG");   // the refusal names the units that WOULD work
    }

    @Test
    @DisplayName("a unit differing only in case is accepted — codes are not normalised at rest")
    void caseOnlyDifferenceIsAccepted() {
        // The registry holds "KG" and "l". Both of these must pass.
        assertThatCode(() -> purchaseOrderService.create(handTyped(REAL_INGREDIENT, "kg")))
                .doesNotThrowAnyException();
        assertThatCode(() -> purchaseOrderService.create(handTyped(REAL_INGREDIENT, "L")))
                .doesNotThrowAnyException();
    }

    @Test
    @DisplayName("every offending line is named, not only the first")
    void allOffendingLinesAreReported() {
        UUID secondGhost = UUID.fromString("33333333-3333-4333-8333-333333333333");
        CreatePurchaseOrderRequest req = new CreatePurchaseOrderRequest(vendorId, BRANCH, null, "two bad lines",
                List.of(
                        new CreatePurchaseOrderRequest.Line(null, REAL_INGREDIENT, BigDecimal.ONE, "KG", 1000L),
                        new CreatePurchaseOrderRequest.Line(null, GHOST_INGREDIENT, BigDecimal.ONE, "KG", 1000L),
                        new CreatePurchaseOrderRequest.Line(null, secondGhost, BigDecimal.ONE, "KG", 1000L)));

        // A caller fixing a twenty-line order one refusal at a time will stop using the screen.
        assertThatThrownBy(() -> purchaseOrderService.create(req))
                .isInstanceOf(IngredientNotInTenantException.class)
                .hasMessageContaining("line 2")
                .hasMessageContaining("line 3")
                .hasMessageContaining(GHOST_INGREDIENT.toString())
                .hasMessageContaining(secondGhost.toString());
    }

    @Test
    @DisplayName("inventory being unreachable allows the create — a brief outage is not a bad request")
    void unreachableInventoryDegradesOpen() {
        when(inventoryCategoryClient.getIngredientCategories(anyList()))
                .thenThrow(new RuntimeException("connection refused"));
        when(inventoryUomClient.listUomCodes(any()))
                .thenThrow(new RuntimeException("connection refused"));

        // Fail-closed on a definitive no, degrade-open on an outage. Coupling purchasing's
        // availability to inventory's uptime would be a worse defect than the one being fixed.
        assertThatCode(() -> purchaseOrderService.create(handTyped(GHOST_INGREDIENT, "FURLONG")))
                .doesNotThrowAnyException();
    }

    // ── Receipt ─────────────────────────────────────────────────────────────────────────────

    /** A SENT order whose line was created before the gate existed — written directly, as history would be. */
    private PurchaseOrder sentOrderWithLine(UUID ingredientId, String uom) {
        PurchaseOrder po = new PurchaseOrder();
        po.setTenantId(TENANT);
        po.setVendorId(vendorId);
        po.setBranchId(BRANCH);
        po.setStatus(PoStatus.SENT);
        PurchaseOrderLine line = new PurchaseOrderLine();
        line.setTenantId(TENANT);
        line.setPurchaseOrder(po);
        line.setIngredientId(ingredientId);
        line.setUom(uom);
        line.setQty(BigDecimal.valueOf(5));
        line.setUnitPricePaisa(100000L);
        line.setLineTotalPaisa(500000L);
        po.getLines().add(line);
        po.setTotalPaisa(500000L);
        return purchaseOrderRepository.save(po);
    }

    @Test
    @DisplayName("receiving a pre-gate order whose ingredient does not resolve is refused, and writes nothing")
    void receiptOfAGhostIngredientIsRefused() {
        PurchaseOrder po = sentOrderWithLine(GHOST_INGREDIENT, "KG");
        UUID lineId = po.getLines().get(0).getId();
        long receiptsBefore = mockGrnReceiptRepository.count();

        assertThatThrownBy(() -> grnReceiptSimulator.simulateReceive(po.getId(),
                new MockReceiveRequest(List.of(new MockReceiveRequest.Line(lineId, BigDecimal.valueOf(5)))),
                "idem-ghost"))
                .isInstanceOf(IngredientNotInTenantException.class);

        assertThat(mockGrnReceiptRepository.count())
                .as("no receipt row may be written by a refused receipt")
                .isEqualTo(receiptsBefore);
        assertThat(purchaseOrderRepository.findById(po.getId()).orElseThrow().getStatus())
                .as("the order must not have advanced")
                .isEqualTo(PoStatus.SENT);
    }

    @Test
    @DisplayName("receiving a pre-gate order whose unit the registry does not define is refused")
    void receiptOfAnUnknownUnitIsRefused() {
        PurchaseOrder po = sentOrderWithLine(REAL_INGREDIENT, "FURLONG");
        UUID lineId = po.getLines().get(0).getId();

        assertThatThrownBy(() -> grnReceiptSimulator.simulateReceive(po.getId(),
                new MockReceiveRequest(List.of(new MockReceiveRequest.Line(lineId, BigDecimal.valueOf(7)))),
                "idem-furlong"))
                .isInstanceOf(PackUomInvalidException.class);

        assertThat(purchaseOrderRepository.findById(po.getId()).orElseThrow().getStatus())
                .isEqualTo(PoStatus.SENT);
    }

    @Test
    @DisplayName("a refusal does not consume the idempotency key, so a corrected retry still receives")
    void aRefusalLeavesTheIdempotencyKeyUnspent() {
        PurchaseOrder bad = sentOrderWithLine(GHOST_INGREDIENT, "KG");
        String key = "idem-shared-" + UUID.randomUUID();

        assertThatThrownBy(() -> grnReceiptSimulator.simulateReceive(bad.getId(),
                new MockReceiveRequest(List.of(new MockReceiveRequest.Line(bad.getLines().get(0).getId(),
                        BigDecimal.valueOf(5)))), key))
                .isInstanceOf(IngredientNotInTenantException.class);

        // The same key, now against a line that is fine. If the refusal had burned the key this
        // would silently return a replay of a receipt that never happened.
        PurchaseOrder good = sentOrderWithLine(REAL_INGREDIENT, "KG");
        var response = grnReceiptSimulator.simulateReceive(good.getId(),
                new MockReceiveRequest(List.of(new MockReceiveRequest.Line(good.getLines().get(0).getId(),
                        BigDecimal.valueOf(5)))), key);
        assertThat(response.grnIds()).hasSize(1);
        assertThat(purchaseOrderRepository.findById(good.getId()).orElseThrow().getStatus())
                .isEqualTo(PoStatus.FULLY_RECEIVED);
    }

    /**
     * F-31-01. The blocker 36-01 found and nobody had recorded: a two-line receipt answered
     * 409 CONFLICT because every row in the batch carried the caller's single idempotency key and
     * collided on {@code uq_mock_grn_idem UNIQUE (tenant_id, idempotency_key)}. Receiving was not
     * broken — receiving MORE THAN ONE LINE was, which is every realistic delivery.
     */
    @Test
    @DisplayName("a receipt of MORE THAN ONE LINE succeeds (F-31-01)")
    void multiLineReceiptSucceeds() {
        PurchaseOrder po = new PurchaseOrder();
        po.setTenantId(TENANT);
        po.setVendorId(vendorId);
        po.setBranchId(BRANCH);
        po.setStatus(PoStatus.SENT);
        for (int i = 0; i < 2; i++) {
            PurchaseOrderLine line = new PurchaseOrderLine();
            line.setTenantId(TENANT);
            line.setPurchaseOrder(po);
            line.setIngredientId(REAL_INGREDIENT);
            line.setUom("KG");
            line.setQty(BigDecimal.valueOf(2));
            line.setUnitPricePaisa(100000L);
            line.setLineTotalPaisa(200000L);
            po.getLines().add(line);
        }
        po.setTotalPaisa(400000L);
        PurchaseOrder saved = purchaseOrderRepository.save(po);

        var response = grnReceiptSimulator.simulateReceive(saved.getId(),
                new MockReceiveRequest(List.of(
                        new MockReceiveRequest.Line(saved.getLines().get(0).getId(), BigDecimal.valueOf(2)),
                        new MockReceiveRequest.Line(saved.getLines().get(1).getId(), BigDecimal.valueOf(2)))),
                "idem-two-lines-" + UUID.randomUUID());

        // One batch, one grnId, both lines received, the order fully received.
        assertThat(response.grnIds()).hasSize(1);
        assertThat(purchaseOrderRepository.findById(saved.getId()).orElseThrow().getStatus())
                .isEqualTo(PoStatus.FULLY_RECEIVED);
    }

    @Test
    @DisplayName("a valid receipt is unaffected — one batch, and the status transitions as before")
    void validReceiptStillWorks() {
        PurchaseOrder po = sentOrderWithLine(REAL_INGREDIENT, "KG");
        var response = grnReceiptSimulator.simulateReceive(po.getId(),
                new MockReceiveRequest(List.of(new MockReceiveRequest.Line(po.getLines().get(0).getId(),
                        BigDecimal.valueOf(5)))), "idem-valid-" + UUID.randomUUID());

        assertThat(response.grnIds()).hasSize(1);
        assertThat(purchaseOrderRepository.findById(po.getId()).orElseThrow().getStatus())
                .isEqualTo(PoStatus.FULLY_RECEIVED);
    }
}
