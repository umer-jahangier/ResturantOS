package io.restaurantos.purchasing.web;

import io.restaurantos.purchasing.domain.enums.InvoiceStatus;
import io.restaurantos.purchasing.domain.enums.PoStatus;
import io.restaurantos.purchasing.repository.MockGrnReceiptRepository;
import io.restaurantos.purchasing.repository.PurchaseOrderRepository;
import io.restaurantos.purchasing.repository.VendorInvoiceRepository;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.time.Instant;
import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.UUID;

/**
 * 10-09: intentionally NOT gated with @PreAuthorize. This is a service-to-service
 * endpoint (X-Internal-Service secret enforced by {@link PurchasingInternalServiceFilter}
 * via {@code /internal/**} permitAll in PurchasingSecurityConfig); there is no user
 * JWT/principal on these requests, so hasAuthority(...) would never resolve.
 * PurchasingEndpointAuthorizationIT explicitly allowlists this class in its
 * every-endpoint-is-gated reflection guard.
 */
@RestController
@RequestMapping("/internal/purchasing")
public class InternalPurchasingController {

    private final PurchaseOrderRepository purchaseOrderRepository;
    private final MockGrnReceiptRepository mockGrnReceiptRepository;
    private final VendorInvoiceRepository vendorInvoiceRepository;

    public InternalPurchasingController(PurchaseOrderRepository purchaseOrderRepository,
                                        MockGrnReceiptRepository mockGrnReceiptRepository,
                                        VendorInvoiceRepository vendorInvoiceRepository) {
        this.purchaseOrderRepository = purchaseOrderRepository;
        this.mockGrnReceiptRepository = mockGrnReceiptRepository;
        this.vendorInvoiceRepository = vendorInvoiceRepository;
    }

    @GetMapping("/branches/{branchId}/open-receipts")
    public OpenReceiptsResponse openReceipts(@PathVariable UUID branchId) {
        List<UUID> poIds = purchaseOrderRepository.findByBranchIdAndStatusIn(branchId, List.of(PoStatus.SENT))
                .stream()
                .filter(po -> !mockGrnReceiptRepository.existsByPurchaseOrderId(po.getId()))
                .map(po -> po.getId())
                .toList();
        return new OpenReceiptsResponse(poIds.size(), poIds);
    }

    @GetMapping("/branches/{branchId}/pending-match-invoices")
    public PendingInvoicesResponse pendingMatch(@PathVariable UUID branchId,
                                                @RequestParam(defaultValue = "48") int olderThanHours) {
        Instant cutoff = Instant.now().minus(olderThanHours, ChronoUnit.HOURS);
        List<UUID> invoiceIds = vendorInvoiceRepository
                .findStaleMismatched(branchId, InvoiceStatus.MISMATCHED, cutoff)
                .stream()
                .map(i -> i.getId())
                .toList();
        return new PendingInvoicesResponse(invoiceIds.size(), invoiceIds);
    }

    @GetMapping("/invoices/unmatched-count")
    public long unmatchedCount(
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate periodEnd) {
        return vendorInvoiceRepository.countByStatusAndInvoiceDateBefore(InvoiceStatus.MISMATCHED, periodEnd);
    }

    public record OpenReceiptsResponse(long count, List<UUID> poIds) {}

    public record PendingInvoicesResponse(long count, List<UUID> invoiceIds) {}
}
