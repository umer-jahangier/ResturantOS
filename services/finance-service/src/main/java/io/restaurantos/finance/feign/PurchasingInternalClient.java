package io.restaurantos.finance.feign;

import io.restaurantos.finance.config.FeignClientConfig;
import org.springframework.cloud.openfeign.FeignClient;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestParam;

import java.time.LocalDate;
import java.util.UUID;

/**
 * The two procurement pre-checks a period close depends on.
 *
 * <p>{@link #getPendingGrnCount} used to live on {@code InventoryInternalClient}. Inventory
 * answered it by counting {@code inventory_movements} rows carrying a
 * {@code reference_type = 'PENDING_GRN'} sentinel that nothing has ever written — a real,
 * tenant-scoped query that structurally returned 0 for every tenant, so the gate never once
 * blocked a close. Its own Javadoc said Phase 10 would repoint it; Phase 10 shipped real GRNs into
 * {@code purchasing_db} and left the seam untouched. Purchasing owns goods receipts and vendor
 * invoices, so both questions belong to the same callee and the same client.
 */
@FeignClient(
        name = "purchasing-service",
        configuration = FeignClientConfig.class,
        fallback = PurchasingInternalClientFallback.class
)
public interface PurchasingInternalClient {

    @GetMapping("/internal/purchasing/invoices/unmatched-count")
    long getUnmatchedInvoiceCount(
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate periodEnd
    );

    /** Goods received on or before {@code periodEnd} with no MATCHED vendor invoice yet. */
    @GetMapping("/internal/purchasing/grn/pending-count")
    long getPendingGrnCount(
            @RequestHeader("X-Tenant-Id") UUID tenantId,
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate periodEnd
    );
}
