package io.restaurantos.purchasing;

import io.restaurantos.purchasing.domain.enums.InvoiceStatus;
import io.restaurantos.purchasing.domain.enums.PoStatus;
import io.restaurantos.purchasing.domain.model.PurchaseOrder;
import io.restaurantos.purchasing.domain.model.PurchaseOrderLine;
import io.restaurantos.purchasing.domain.model.Vendor;
import io.restaurantos.purchasing.domain.model.VendorInvoice;
import io.restaurantos.purchasing.domain.model.VendorInvoiceLine;
import io.restaurantos.purchasing.dto.SpendAnalyticsDto;
import io.restaurantos.purchasing.dto.SpendBucketDto;
import io.restaurantos.purchasing.repository.PurchaseOrderLineRepository;
import io.restaurantos.purchasing.repository.PurchaseOrderRepository;
import io.restaurantos.purchasing.repository.VendorInvoiceRepository;
import io.restaurantos.purchasing.repository.VendorRepository;
import io.restaurantos.purchasing.service.VendorAnalyticsService;
import io.restaurantos.shared.tenant.TenantContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.within;

/**
 * PUR-06: proves spendReport() aggregates by vendor AND by category with period-over-period deltas, on
 * mock invoice/line data (F8 fixture — see 10-MOCK-FIXTURES.md). No finance-service / inventory-service
 * dependency: analytics reads purchasing_db only, and category resolution goes through the classpath
 * spend-category-map.yml via IngredientCategoryResolver.
 */
class SpendAnalyticsIT extends PurchasingTestBase {

    // Fixed seed ingredient UUIDs from 10-MOCK-FIXTURES.md, mapped in spend-category-map.yml.
    private static final UUID MEAT_INGREDIENT = UUID.fromString("11111111-1111-4111-8111-111111110001");
    private static final UUID PRODUCE_INGREDIENT = UUID.fromString("11111111-1111-4111-8111-111111110002");
    private static final UUID DAIRY_INGREDIENT = UUID.fromString("11111111-1111-4111-8111-111111110003");

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

    private UUID branchId;
    private UUID vendorAId;
    private UUID vendorBId;

    @BeforeEach
    void setUp() {
        UUID tenantId = UUID.randomUUID();
        branchId = UUID.randomUUID();
        tenantContext.set(tenantId, branchId, UUID.randomUUID(), null);

        Vendor vendorA = newVendor(tenantId, "Vendor A");
        Vendor vendorB = newVendor(tenantId, "Vendor B");
        vendorAId = vendorA.getId();
        vendorBId = vendorB.getId();

        PurchaseOrder poA = newPurchaseOrder(tenantId, vendorAId);
        PurchaseOrderLine produceLine = newPoLine(tenantId, poA, PRODUCE_INGREDIENT);
        PurchaseOrderLine dairyLine = newPoLine(tenantId, poA, DAIRY_INGREDIENT);

        PurchaseOrder poB = newPurchaseOrder(tenantId, vendorBId);
        PurchaseOrderLine meatLine = newPoLine(tenantId, poB, MEAT_INGREDIENT);

        // Vendor A, June 2026 (current window): Produce 50,000, Dairy 30,000
        VendorInvoice invoiceAJun = newInvoice(tenantId, vendorAId, poA.getId(), "INV-A-JUN", LocalDate.of(2026, 6, 15), 80_000L);
        addLine(tenantId, invoiceAJun, produceLine.getId(), 50_000L);
        addLine(tenantId, invoiceAJun, dairyLine.getId(), 30_000L);
        invoiceRepository.save(invoiceAJun);

        // Vendor A, May 2026 (default prior window): Produce 40,000, Dairy 25,000
        VendorInvoice invoiceAMay = newInvoice(tenantId, vendorAId, poA.getId(), "INV-A-MAY", LocalDate.of(2026, 5, 15), 65_000L);
        addLine(tenantId, invoiceAMay, produceLine.getId(), 40_000L);
        addLine(tenantId, invoiceAMay, dairyLine.getId(), 25_000L);
        invoiceRepository.save(invoiceAMay);

        // Vendor B, June 2026 only: Meat 20,000 (no prior-window invoice -> prior spend 0)
        VendorInvoice invoiceBJun = newInvoice(tenantId, vendorBId, poB.getId(), "INV-B-JUN", LocalDate.of(2026, 6, 20), 20_000L);
        addLine(tenantId, invoiceBJun, meatLine.getId(), 20_000L);
        invoiceRepository.save(invoiceBJun);
    }

    @Test
    void spendReport_aggregatesByVendorAndCategoryWithPriorPeriodDeltas() {
        SpendAnalyticsDto report = vendorAnalyticsService.spendReport(
                branchId, LocalDate.of(2026, 6, 1), LocalDate.of(2026, 6, 30), null, null);

        // Default prior window: compareTo = from - 1 day; compareFrom = compareTo - DAYS.between(from,to)
        assertThat(report.compareTo()).isEqualTo(LocalDate.of(2026, 5, 31));
        assertThat(report.compareFrom()).isEqualTo(LocalDate.of(2026, 5, 2));

        SpendBucketDto produce = bucketByLabel(report.byCategory(), "Produce");
        assertThat(produce.spendPaisa()).isEqualTo(50_000L);
        assertThat(produce.priorSpendPaisa()).isEqualTo(40_000L);
        assertThat(produce.deltaPct()).isCloseTo(25.0, within(0.5));

        SpendBucketDto dairy = bucketByLabel(report.byCategory(), "Dairy");
        assertThat(dairy.spendPaisa()).isEqualTo(30_000L);
        assertThat(dairy.priorSpendPaisa()).isEqualTo(25_000L);
        assertThat(dairy.deltaPct()).isCloseTo(20.0, within(0.5));

        SpendBucketDto meat = bucketByLabel(report.byCategory(), "Meat");
        assertThat(meat.spendPaisa()).isEqualTo(20_000L);
        assertThat(meat.priorSpendPaisa()).isEqualTo(0L);
        assertThat(meat.deltaPct()).isNull();

        SpendBucketDto vendorABucket = bucketById(report.byVendor(), vendorAId);
        assertThat(vendorABucket.spendPaisa()).isEqualTo(80_000L);
        assertThat(vendorABucket.priorSpendPaisa()).isEqualTo(65_000L);
        assertThat(vendorABucket.label()).isEqualTo("Vendor A");

        SpendBucketDto vendorBBucket = bucketById(report.byVendor(), vendorBId);
        assertThat(vendorBBucket.spendPaisa()).isEqualTo(20_000L);
        assertThat(vendorBBucket.priorSpendPaisa()).isEqualTo(0L);
        assertThat(vendorBBucket.deltaPct()).isNull();
        assertThat(vendorBBucket.label()).isEqualTo("Vendor B");
    }

    private static SpendBucketDto bucketByLabel(List<SpendBucketDto> buckets, String label) {
        return buckets.stream().filter(b -> b.label().equals(label)).findFirst()
                .orElseThrow(() -> new AssertionError("No bucket labeled " + label));
    }

    private static SpendBucketDto bucketById(List<SpendBucketDto> buckets, UUID id) {
        return buckets.stream().filter(b -> id.equals(b.id())).findFirst()
                .orElseThrow(() -> new AssertionError("No bucket with id " + id));
    }

    private Vendor newVendor(UUID tenantId, String name) {
        Vendor vendor = new Vendor();
        vendor.setTenantId(tenantId);
        vendor.setName(name);
        vendor.setPaymentTerms("NET30");
        return vendorRepository.save(vendor);
    }

    private PurchaseOrder newPurchaseOrder(UUID tenantId, UUID vendorId) {
        PurchaseOrder po = new PurchaseOrder();
        po.setTenantId(tenantId);
        po.setVendorId(vendorId);
        po.setBranchId(branchId);
        po.setStatus(PoStatus.SENT);
        po.setTotalPaisa(0L);
        return purchaseOrderRepository.save(po);
    }

    private PurchaseOrderLine newPoLine(UUID tenantId, PurchaseOrder po, UUID ingredientId) {
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

    private VendorInvoice newInvoice(UUID tenantId, UUID vendorId, UUID purchaseOrderId, String invoiceNo,
                                     LocalDate invoiceDate, long totalPaisa) {
        VendorInvoice invoice = new VendorInvoice();
        invoice.setTenantId(tenantId);
        invoice.setVendorId(vendorId);
        invoice.setPurchaseOrderId(purchaseOrderId);
        invoice.setBranchId(branchId);
        invoice.setInvoiceNo(invoiceNo);
        invoice.setInvoiceDate(invoiceDate);
        invoice.setStatus(InvoiceStatus.MATCHED);
        invoice.setTotalPaisa(totalPaisa);
        invoice.setInputTaxPaisa(0L);
        return invoice;
    }

    private void addLine(UUID tenantId, VendorInvoice invoice, UUID poLineId, long lineTotalPaisa) {
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
