package io.restaurantos.purchasing;

import io.restaurantos.purchasing.domain.enums.InvoiceStatus;
import io.restaurantos.purchasing.domain.enums.LineMatchStatus;
import io.restaurantos.purchasing.domain.enums.PoStatus;
import io.restaurantos.purchasing.domain.model.PurchaseOrder;
import io.restaurantos.purchasing.domain.model.PurchaseOrderLine;
import io.restaurantos.purchasing.domain.model.Vendor;
import io.restaurantos.purchasing.domain.model.VendorInvoice;
import io.restaurantos.purchasing.domain.model.VendorInvoiceLine;
import io.restaurantos.purchasing.dto.PurchaseOrderDto;
import io.restaurantos.purchasing.dto.VendorInvoiceDto;
import io.restaurantos.purchasing.repository.PurchaseOrderRepository;
import io.restaurantos.purchasing.repository.VendorInvoiceRepository;
import io.restaurantos.purchasing.repository.VendorRepository;
import io.restaurantos.purchasing.service.PurchaseOrderService;
import io.restaurantos.purchasing.service.VendorInvoiceService;
import io.restaurantos.shared.tenant.TenantContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 10-10: proves the PO and vendor-invoice list endpoints are branch- and tenant-isolated,
 * status-filterable, and return the same DTO shape (lines / line-match-status) as the detail
 * endpoints. Rows are seeded directly via repositories to isolate the list read-path from the
 * create/approve/match write-paths already covered by other ITs.
 */
class PurchasingListEndpointsIT extends PurchasingTestBase {

    @Autowired
    private PurchaseOrderRepository purchaseOrderRepository;

    @Autowired
    private VendorInvoiceRepository vendorInvoiceRepository;

    @Autowired
    private VendorRepository vendorRepository;

    @Autowired
    private PurchaseOrderService purchaseOrderService;

    @Autowired
    private VendorInvoiceService vendorInvoiceService;

    @Autowired
    private TenantContext tenantContext;

    private UUID tenantId;
    private UUID branchA;
    private UUID branchB;
    private UUID otherTenantId;

    @BeforeEach
    void setUp() {
        tenantId = UUID.randomUUID();
        branchA = UUID.randomUUID();
        branchB = UUID.randomUUID();
        otherTenantId = UUID.randomUUID();
    }

    private UUID seedVendor(UUID tenant) {
        Vendor vendor = new Vendor();
        vendor.setTenantId(tenant);
        vendor.setName("Vendor " + UUID.randomUUID());
        vendor.setPaymentTerms("NET30");
        return vendorRepository.save(vendor).getId();
    }

    private PurchaseOrder seedPo(UUID tenant, UUID branch, PoStatus status) {
        PurchaseOrder po = new PurchaseOrder();
        po.setTenantId(tenant);
        po.setVendorId(seedVendor(tenant));
        po.setBranchId(branch);
        po.setStatus(status);
        po.setTotalPaisa(50_000L);

        PurchaseOrderLine line = new PurchaseOrderLine();
        line.setTenantId(tenant);
        line.setPurchaseOrder(po);
        line.setIngredientId(UUID.randomUUID());
        line.setQty(BigDecimal.TEN);
        line.setUom("kg");
        line.setUnitPricePaisa(5_000L);
        line.setLineTotalPaisa(50_000L);
        po.getLines().add(line);

        return purchaseOrderRepository.save(po);
    }

    private VendorInvoice seedInvoice(UUID tenant, UUID branch, InvoiceStatus status,
                                      LineMatchStatus lineMatchStatus) {
        PurchaseOrder po = seedPo(tenant, branch, PoStatus.SENT);

        VendorInvoice invoice = new VendorInvoice();
        invoice.setTenantId(tenant);
        invoice.setVendorId(seedVendor(tenant));
        invoice.setPurchaseOrderId(po.getId());
        invoice.setBranchId(branch);
        invoice.setInvoiceNo("INV-" + UUID.randomUUID().toString().substring(0, 8));
        invoice.setInvoiceDate(LocalDate.of(2026, 6, 1));
        invoice.setStatus(status);
        invoice.setTotalPaisa(50_000L);
        invoice.setInputTaxPaisa(0L);

        VendorInvoiceLine line = new VendorInvoiceLine();
        line.setTenantId(tenant);
        line.setInvoice(invoice);
        line.setPoLineId(UUID.randomUUID());
        line.setQty(BigDecimal.TEN);
        line.setUnitPricePaisa(5_000L);
        line.setLineTotalPaisa(50_000L);
        line.setMatchStatus(lineMatchStatus);
        invoice.getLines().add(line);

        return vendorInvoiceRepository.save(invoice);
    }

    // ---- Purchase order list ----

    @Test
    void poList_isBranchAndTenantIsolated() {
        tenantContext.set(tenantId, branchA, UUID.randomUUID(), null);
        PurchaseOrder poA1 = seedPo(tenantId, branchA, PoStatus.PENDING_APPROVAL);
        PurchaseOrder poA2 = seedPo(tenantId, branchA, PoStatus.DRAFT);
        seedPo(tenantId, branchB, PoStatus.DRAFT); // branch B, same tenant -> must not appear
        seedPo(otherTenantId, branchA, PoStatus.DRAFT); // same branch id, other tenant -> must not appear

        List<PurchaseOrderDto> result = purchaseOrderService.list(branchA, null);

        assertThat(result).extracting(PurchaseOrderDto::id)
                .containsExactlyInAnyOrder(poA1.getId(), poA2.getId());
        assertThat(result).allSatisfy(dto -> assertThat(dto.lines()).isNotEmpty());
        tenantContext.clear();
    }

    @Test
    void poList_statusFilterNarrows() {
        tenantContext.set(tenantId, branchA, UUID.randomUUID(), null);
        PurchaseOrder pending = seedPo(tenantId, branchA, PoStatus.PENDING_APPROVAL);
        seedPo(tenantId, branchA, PoStatus.DRAFT);

        List<PurchaseOrderDto> result = purchaseOrderService.list(branchA, List.of(PoStatus.PENDING_APPROVAL));

        assertThat(result).extracting(PurchaseOrderDto::id).containsExactly(pending.getId());
        tenantContext.clear();
    }

    @Test
    void poList_neverLeaksAnotherTenantsRow() {
        tenantContext.set(tenantId, branchA, UUID.randomUUID(), null);
        seedPo(otherTenantId, branchA, PoStatus.DRAFT);

        List<PurchaseOrderDto> result = purchaseOrderService.list(branchA, null);

        assertThat(result).isEmpty();
        tenantContext.clear();
    }

    // ---- Vendor invoice list ----

    @Test
    void invoiceList_isBranchAndTenantIsolated() {
        tenantContext.set(tenantId, branchA, UUID.randomUUID(), null);
        VendorInvoice invA1 = seedInvoice(tenantId, branchA, InvoiceStatus.MATCHED, LineMatchStatus.OK);
        VendorInvoice invA2 = seedInvoice(tenantId, branchA, InvoiceStatus.MISMATCHED, LineMatchStatus.PRICE_OVER);
        seedInvoice(tenantId, branchB, InvoiceStatus.MATCHED, LineMatchStatus.OK);
        seedInvoice(otherTenantId, branchA, InvoiceStatus.MATCHED, LineMatchStatus.OK);

        List<VendorInvoiceDto> result = vendorInvoiceService.list(branchA, null);

        assertThat(result).extracting(VendorInvoiceDto::id)
                .containsExactlyInAnyOrder(invA1.getId(), invA2.getId());
        assertThat(result).allSatisfy(dto -> assertThat(dto.lines()).isNotEmpty());
        tenantContext.clear();
    }

    @Test
    void invoiceList_statusFilterNarrowsAndCarriesLineMatchStatus() {
        tenantContext.set(tenantId, branchA, UUID.randomUUID(), null);
        VendorInvoice mismatched = seedInvoice(tenantId, branchA, InvoiceStatus.MISMATCHED, LineMatchStatus.PRICE_OVER);
        seedInvoice(tenantId, branchA, InvoiceStatus.MATCHED, LineMatchStatus.OK);

        List<VendorInvoiceDto> result = vendorInvoiceService.list(branchA, List.of(InvoiceStatus.MISMATCHED));

        assertThat(result).extracting(VendorInvoiceDto::id).containsExactly(mismatched.getId());
        assertThat(result.get(0).lines().get(0).matchStatus()).isEqualTo(LineMatchStatus.PRICE_OVER);
        tenantContext.clear();
    }

    @Test
    void invoiceList_neverLeaksAnotherTenantsRow() {
        tenantContext.set(tenantId, branchA, UUID.randomUUID(), null);
        seedInvoice(otherTenantId, branchA, InvoiceStatus.MATCHED, LineMatchStatus.OK);

        List<VendorInvoiceDto> result = vendorInvoiceService.list(branchA, null);

        assertThat(result).isEmpty();
        tenantContext.clear();
    }
}
