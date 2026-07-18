package io.restaurantos.inventory.web;

import io.restaurantos.inventory.repository.GrnPendingCountRepository;
import io.restaurantos.shared.tenant.TenantContext;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZoneOffset;
import java.util.UUID;

/**
 * Internal GRN endpoint — secured by the {@code X-Internal-Service} shared-secret header
 * (InventoryInternalServiceFilter, T-8-SPOOF), NOT JWT/OPA (this is a service-to-service call,
 * not user-facing). Contract: finance-service's {@code InventoryInternalClient} calls
 * {@code GET /internal/grn/pending-count} and expects a bare {@code long} body (NOT
 * ApiResponse-wrapped) — mirrors pos-service's {@code InternalPosController} exactly, including
 * its optional {@code X-Tenant-Id} header + manual {@code tenantContext.set} fallback (Pitfall 5:
 * finance's Feign client does not forward tenant context).
 */
@RestController
@RequestMapping("/internal")
public class InternalGrnController {

    private final GrnPendingCountRepository grnPendingCountRepository;
    private final TenantContext tenantContext;

    public InternalGrnController(GrnPendingCountRepository grnPendingCountRepository,
                                  TenantContext tenantContext) {
        this.grnPendingCountRepository = grnPendingCountRepository;
        this.tenantContext = tenantContext;
    }

    /**
     * Counts pending (unreconciled) GRNs as-of periodEnd. See
     * {@link GrnPendingCountRepository#countPendingAsOf} for why this is 0 today (Assumption A1
     * — Phase 10 purchasing does not exist yet).
     *
     * @return bare Long (NOT ApiResponse-wrapped) — exact contract required by finance's
     *         InventoryInternalClient
     */
    @GetMapping("/grn/pending-count")
    public ResponseEntity<Long> pendingGrnCount(
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate periodEnd,
            @RequestHeader(value = "X-Tenant-Id", required = false) UUID tenantId) {
        if (tenantId != null && tenantContext.getTenantId().isEmpty()) {
            tenantContext.set(tenantId, null, null, null);
        }
        UUID resolvedTenantId = tenantContext.requireTenantId();
        long count = grnPendingCountRepository.countPendingAsOf(
                resolvedTenantId, periodEnd.atTime(LocalTime.MAX).toInstant(ZoneOffset.UTC));
        return ResponseEntity.ok(count);
    }
}
