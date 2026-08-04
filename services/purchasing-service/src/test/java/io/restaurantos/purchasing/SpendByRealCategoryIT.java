package io.restaurantos.purchasing;

import io.restaurantos.purchasing.adapter.FeignIngredientCategoryResolver;
import io.restaurantos.purchasing.domain.enums.InvoiceStatus;
import io.restaurantos.purchasing.domain.enums.PoStatus;
import io.restaurantos.purchasing.domain.model.PurchaseOrder;
import io.restaurantos.purchasing.domain.model.PurchaseOrderLine;
import io.restaurantos.purchasing.domain.model.Vendor;
import io.restaurantos.purchasing.domain.model.VendorInvoice;
import io.restaurantos.purchasing.domain.model.VendorInvoiceLine;
import io.restaurantos.purchasing.dto.SpendAnalyticsDto;
import io.restaurantos.purchasing.dto.SpendBucketDto;
import io.restaurantos.purchasing.feign.InventoryCategoryClient;
import io.restaurantos.purchasing.feign.InventoryCategoryClient.IngredientCategoryResponse;
import io.restaurantos.purchasing.repository.PurchaseOrderLineRepository;
import io.restaurantos.purchasing.repository.PurchaseOrderRepository;
import io.restaurantos.purchasing.repository.VendorInvoiceRepository;
import io.restaurantos.purchasing.repository.VendorRepository;
import io.restaurantos.purchasing.service.IngredientCategoryResolver;
import io.restaurantos.purchasing.service.VendorAnalyticsService;
import io.restaurantos.shared.tenant.TenantContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;
import org.springframework.test.context.bean.override.mockito.MockitoBean;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * PUR-08 / D-09 / Success Criterion 7: proves the real, Feign-backed
 * {@link FeignIngredientCategoryResolver} — not the deleted classpath category-map mock — is what
 * actually resolves spend-by-category labels, that resolution happens exactly once per report
 * regardless of invoice-line count (T-08.2-113), and that an inventory-service outage degrades the
 * report to "Uncategorized" buckets rather than failing it (T-08.2-112).
 *
 * <p>{@link PurchasingTestBase} pins {@code restaurantos.inventory.integration-mode=mock} for every
 * IT in this module via {@code @DynamicPropertySource}, which cannot be overridden from a subclass
 * (dynamic property sources from a superclass are re-applied after a subclass's and would win).
 * Rather than fight that, this test keeps the module-wide mock-mode wiring untouched and instead
 * makes the REAL {@link FeignIngredientCategoryResolver} the active {@link IngredientCategoryResolver}
 * bean via a {@code @Primary} {@code @TestConfiguration} bean, with only the outbound
 * {@link InventoryCategoryClient} Feign call mocked. Every other line of {@code resolveAll} —
 * chunking, blank-name substitution, and the degrade-on-failure catch block — executes for real.
 */
class SpendByRealCategoryIT extends PurchasingTestBase {

    @TestConfiguration
    static class RealCategoryResolverConfig {
        @Bean
        @Primary
        IngredientCategoryResolver realIngredientCategoryResolver(InventoryCategoryClient inventoryCategoryClient) {
            return new FeignIngredientCategoryResolver(inventoryCategoryClient);
        }
    }

    @MockitoBean
    private InventoryCategoryClient inventoryCategoryClient;

    @Autowired
    private VendorAnalyticsService vendorAnalyticsService;

    @Autowired
    private VendorRepository vendorRepository;

    @Autowired
    private PurchaseOrderRepository purchaseOrderRepository;

    @Autowired
    private PurchaseOrderLineRepository lineRepository;

    @Autowired
    private VendorInvoiceRepository invoiceRepository;

    @Autowired
    private TenantContext tenantContext;

    private UUID tenantId;
    private UUID branchId;
    private UUID vendorId;

    @BeforeEach
    void setUp() {
        tenantId = UUID.randomUUID();
        branchId = UUID.randomUUID();
        tenantContext.set(tenantId, branchId, UUID.randomUUID(), null);

        Vendor vendor = new Vendor();
        vendor.setTenantId(tenantId);
        vendor.setName("Real-Category Vendor");
        vendor.setPaymentTerms("NET30");
        vendorId = vendorRepository.save(vendor).getId();
    }

    @Test
    void spendBucketsUseCategoryNamesReturnedByInventoryService() {
        UUID produceIngredient = UUID.randomUUID();
        UUID dairyIngredient = UUID.randomUUID();
        when(inventoryCategoryClient.getIngredientCategories(anyList())).thenReturn(List.of(
                new IngredientCategoryResponse(produceIngredient, UUID.randomUUID(), "Produce", "Food/Produce"),
                new IngredientCategoryResponse(dairyIngredient, UUID.randomUUID(), "Dairy", "Food/Dairy")));

        PurchaseOrder po = newPurchaseOrder();
        PurchaseOrderLine produceLine = newPoLine(po, produceIngredient);
        PurchaseOrderLine dairyLine = newPoLine(po, dairyIngredient);

        VendorInvoice invoice = newInvoice(po, "INV-REAL-1", LocalDate.of(2026, 6, 15), 90_000L);
        addLine(invoice, produceLine.getId(), 60_000L);
        addLine(invoice, dairyLine.getId(), 30_000L);
        invoiceRepository.save(invoice);

        SpendAnalyticsDto report = vendorAnalyticsService.spendReport(
                branchId, LocalDate.of(2026, 6, 1), LocalDate.of(2026, 6, 30), null, null);

        assertThat(bucketByLabel(report.byCategory(), "Produce").spendPaisa()).isEqualTo(60_000L);
        assertThat(bucketByLabel(report.byCategory(), "Dairy").spendPaisa()).isEqualTo(30_000L);
    }

    @Test
    void categoryResolutionIsCalledOncePerReportNotOncePerLine() {
        UUID ingredientA = UUID.randomUUID();
        UUID ingredientB = UUID.randomUUID();
        UUID ingredientC = UUID.randomUUID();
        when(inventoryCategoryClient.getIngredientCategories(anyList())).thenReturn(List.of(
                new IngredientCategoryResponse(ingredientA, UUID.randomUUID(), "Meat", "Food/Meat"),
                new IngredientCategoryResponse(ingredientB, UUID.randomUUID(), "Produce", "Food/Produce"),
                new IngredientCategoryResponse(ingredientC, UUID.randomUUID(), "Dairy", "Food/Dairy")));

        PurchaseOrder po = newPurchaseOrder();
        PurchaseOrderLine lineA = newPoLine(po, ingredientA);
        PurchaseOrderLine lineB = newPoLine(po, ingredientB);
        PurchaseOrderLine lineC = newPoLine(po, ingredientC);

        // 6 invoice lines across 3 ingredients, spread over 2 invoices.
        VendorInvoice invoice1 = newInvoice(po, "INV-REAL-2", LocalDate.of(2026, 6, 5), 30_000L);
        addLine(invoice1, lineA.getId(), 5_000L);
        addLine(invoice1, lineB.getId(), 5_000L);
        addLine(invoice1, lineC.getId(), 5_000L);
        invoiceRepository.save(invoice1);

        VendorInvoice invoice2 = newInvoice(po, "INV-REAL-3", LocalDate.of(2026, 6, 20), 15_000L);
        addLine(invoice2, lineA.getId(), 5_000L);
        addLine(invoice2, lineB.getId(), 5_000L);
        addLine(invoice2, lineC.getId(), 5_000L);
        invoiceRepository.save(invoice2);

        vendorAnalyticsService.spendReport(
                branchId, LocalDate.of(2026, 6, 1), LocalDate.of(2026, 6, 30), null, null);

        verify(inventoryCategoryClient, times(1)).getIngredientCategories(anyList());
    }

    @Test
    void unresolvedIngredientFallsBackToUncategorized() {
        UUID resolvedIngredient = UUID.randomUUID();
        UUID unresolvedIngredient = UUID.randomUUID();
        // Client response omits unresolvedIngredient entirely.
        when(inventoryCategoryClient.getIngredientCategories(anyList())).thenReturn(List.of(
                new IngredientCategoryResponse(resolvedIngredient, UUID.randomUUID(), "Produce", "Food/Produce")));

        PurchaseOrder po = newPurchaseOrder();
        PurchaseOrderLine resolvedLine = newPoLine(po, resolvedIngredient);
        PurchaseOrderLine unresolvedLine = newPoLine(po, unresolvedIngredient);

        VendorInvoice invoice = newInvoice(po, "INV-REAL-4", LocalDate.of(2026, 6, 10), 25_000L);
        addLine(invoice, resolvedLine.getId(), 15_000L);
        addLine(invoice, unresolvedLine.getId(), 10_000L);
        invoiceRepository.save(invoice);

        SpendAnalyticsDto report = vendorAnalyticsService.spendReport(
                branchId, LocalDate.of(2026, 6, 1), LocalDate.of(2026, 6, 30), null, null);

        assertThat(bucketByLabel(report.byCategory(), "Produce").spendPaisa()).isEqualTo(15_000L);
        assertThat(bucketByLabel(report.byCategory(), "Uncategorized").spendPaisa()).isEqualTo(10_000L);
    }

    @Test
    void inventoryServiceFailureDegradesInsteadOfFailingTheReport() {
        UUID ingredientId = UUID.randomUUID();
        when(inventoryCategoryClient.getIngredientCategories(anyList()))
                .thenThrow(new RuntimeException("simulated inventory-service outage"));

        PurchaseOrder po = newPurchaseOrder();
        PurchaseOrderLine line = newPoLine(po, ingredientId);

        VendorInvoice invoice = newInvoice(po, "INV-REAL-5", LocalDate.of(2026, 6, 12), 40_000L);
        addLine(invoice, line.getId(), 40_000L);
        invoiceRepository.save(invoice);

        // If the resolver failed to degrade, this call throws and the test fails right here —
        // proving the report renders instead of the endpoint going dark.
        SpendAnalyticsDto report = vendorAnalyticsService.spendReport(
                branchId, LocalDate.of(2026, 6, 1), LocalDate.of(2026, 6, 30), null, null);
        assertThat(bucketByLabel(report.byCategory(), "Uncategorized").spendPaisa()).isEqualTo(40_000L);
        // Vendor aggregation must not depend on category resolution at all.
        SpendBucketDto vendorBucket = report.byVendor().stream()
                .filter(b -> vendorId.equals(b.id()))
                .findFirst()
                .orElseThrow(() -> new AssertionError("No vendor bucket for " + vendorId));
        assertThat(vendorBucket.spendPaisa()).isEqualTo(40_000L);
    }

    @Test
    void nullIngredientIdOnALegacyPoLineIsUncategorized() {
        // purchase_order_lines.ingredient_id is DB NOT NULL, so a "legacy" line can never itself
        // carry a null ingredient id. The real-world equivalent is an invoice line whose poLineId
        // does not resolve to any loaded PurchaseOrderLine (e.g. a since-deleted/legacy PO line) —
        // VendorAnalyticsService.aggregate() falls back to "Uncategorized" in that case too.
        PurchaseOrder po = newPurchaseOrder();
        UUID danglingPoLineId = UUID.randomUUID();

        VendorInvoice invoice = newInvoice(po, "INV-REAL-6", LocalDate.of(2026, 6, 8), 12_000L);
        addLine(invoice, danglingPoLineId, 12_000L);
        invoiceRepository.save(invoice);

        SpendAnalyticsDto report = vendorAnalyticsService.spendReport(
                branchId, LocalDate.of(2026, 6, 1), LocalDate.of(2026, 6, 30), null, null);

        assertThat(bucketByLabel(report.byCategory(), "Uncategorized").spendPaisa()).isEqualTo(12_000L);
    }

    private static SpendBucketDto bucketByLabel(List<SpendBucketDto> buckets, String label) {
        return buckets.stream().filter(b -> b.label().equals(label)).findFirst()
                .orElseThrow(() -> new AssertionError("No bucket labeled " + label));
    }

    private PurchaseOrder newPurchaseOrder() {
        PurchaseOrder po = new PurchaseOrder();
        po.setTenantId(tenantId);
        po.setVendorId(vendorId);
        po.setBranchId(branchId);
        po.setStatus(PoStatus.SENT);
        po.setTotalPaisa(0L);
        return purchaseOrderRepository.save(po);
    }

    private PurchaseOrderLine newPoLine(PurchaseOrder po, UUID ingredientId) {
        PurchaseOrderLine line = new PurchaseOrderLine();
        line.setTenantId(tenantId);
        line.setPurchaseOrder(po);
        line.setIngredientId(ingredientId);
        line.setQty(BigDecimal.ONE);
        line.setUom("kg");
        line.setUnitPricePaisa(1L);
        line.setLineTotalPaisa(1L);
        return lineRepository.save(line);
    }

    private VendorInvoice newInvoice(PurchaseOrder po, String invoiceNo, LocalDate invoiceDate, long totalPaisa) {
        VendorInvoice invoice = new VendorInvoice();
        invoice.setTenantId(tenantId);
        invoice.setVendorId(vendorId);
        invoice.setPurchaseOrderId(po.getId());
        invoice.setBranchId(branchId);
        invoice.setInvoiceNo(invoiceNo);
        invoice.setInvoiceDate(invoiceDate);
        invoice.setStatus(InvoiceStatus.MATCHED);
        invoice.setTotalPaisa(totalPaisa);
        invoice.setInputTaxPaisa(0L);
        return invoice;
    }

    private void addLine(VendorInvoice invoice, UUID poLineId, long lineTotalPaisa) {
        VendorInvoiceLine line = new VendorInvoiceLine();
        line.setTenantId(tenantId);
        line.setInvoice(invoice);
        line.setPoLineId(poLineId);
        line.setQty(BigDecimal.ONE);
        line.setUnitPricePaisa(lineTotalPaisa);
        line.setLineTotalPaisa(lineTotalPaisa);
        invoice.getLines().add(line);
    }
}
