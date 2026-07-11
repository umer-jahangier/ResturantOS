package io.restaurantos.purchasing.service;

import io.restaurantos.purchasing.domain.model.MockGrnReceipt;
import io.restaurantos.purchasing.domain.model.PurchaseOrder;
import io.restaurantos.purchasing.dto.VendorScorecardDto;
import io.restaurantos.purchasing.repository.MockGrnReceiptRepository;
import io.restaurantos.purchasing.repository.PurchaseOrderRepository;
import io.restaurantos.purchasing.repository.VendorInvoiceRepository;
import io.restaurantos.shared.tenant.TenantContext;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.ZoneOffset;
import java.util.List;
import java.util.UUID;

@Service
public class VendorAnalyticsService {

    private final PurchaseOrderRepository purchaseOrderRepository;
    private final MockGrnReceiptRepository mockGrnReceiptRepository;
    private final VendorInvoiceRepository invoiceRepository;
    private final TenantContext tenantContext;

    public VendorAnalyticsService(PurchaseOrderRepository purchaseOrderRepository,
                                  MockGrnReceiptRepository mockGrnReceiptRepository,
                                  VendorInvoiceRepository invoiceRepository,
                                  TenantContext tenantContext) {
        this.purchaseOrderRepository = purchaseOrderRepository;
        this.mockGrnReceiptRepository = mockGrnReceiptRepository;
        this.invoiceRepository = invoiceRepository;
        this.tenantContext = tenantContext;
    }

    @Transactional(readOnly = true)
    public VendorScorecardDto scorecard(UUID vendorId, UUID branchId) {
        UUID tenantId = tenantContext.requireTenantId();
        List<PurchaseOrder> pos = purchaseOrderRepository.findByTenantIdAndVendorIdAndBranchId(tenantId, vendorId, branchId);
        int totalPos = pos.size();
        int onTime = 0;
        int withReceipt = 0;
        long totalSpend = invoiceRepository.findByTenantIdAndBranchIdOrderByInvoiceDateDesc(tenantId, branchId)
                .stream()
                .filter(i -> i.getVendorId().equals(vendorId))
                .mapToLong(i -> i.getTotalPaisa())
                .sum();

        for (PurchaseOrder po : pos) {
            List<MockGrnReceipt> receipts = mockGrnReceiptRepository.findByPurchaseOrderId(po.getId());
            if (receipts.isEmpty()) {
                continue;
            }
            withReceipt++;
            MockGrnReceipt first = receipts.getFirst();
            if (po.getExpectedDeliveryDate() != null) {
                var deadline = po.getExpectedDeliveryDate().plusDays(1).atStartOfDay(ZoneOffset.UTC).toInstant();
                if (!first.getReceivedAt().isAfter(deadline)) {
                    onTime++;
                }
            }
        }

        double onTimePct = withReceipt == 0 ? 0.0 : (100.0 * onTime / withReceipt);
        double fillRate = totalPos == 0 ? 0.0 : (100.0 * withReceipt / totalPos);

        return new VendorScorecardDto(vendorId, branchId, onTimePct, fillRate, totalSpend, totalPos);
    }
}
