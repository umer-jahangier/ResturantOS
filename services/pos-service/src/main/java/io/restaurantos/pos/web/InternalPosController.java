package io.restaurantos.pos.web;

import io.restaurantos.pos.repository.OrderRepository;
import io.restaurantos.shared.tenant.TenantContext;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDate;
import java.util.UUID;

/**
 * Internal POS endpoints — secured by X-Internal-Service header (not JWT).
 * Contract: Finance service's PosInternalClient calls GET /internal/orders/open-count
 * and expects a bare Long (NOT wrapped in ApiResponse).
 */
@RestController
@RequestMapping("/internal")
public class InternalPosController {

    private final OrderRepository orderRepository;
    private final TenantContext tenantContext;

    public InternalPosController(OrderRepository orderRepository, TenantContext tenantContext) {
        this.orderRepository = orderRepository;
        this.tenantContext = tenantContext;
    }

    /**
     * Count orders in non-terminal states whose business date falls within [periodStart, periodEnd].
     * Business date = openedAt - 4 hours, date portion (UTC).
     * Scoped by tenant via RLS (TenantContext set from X-Tenant-Id header by the tenant filter interceptor).
     *
     * @return bare Long (NOT ApiResponse-wrapped) — exact contract required by Finance PosInternalClient
     */
    @GetMapping("/orders/open-count")
    public ResponseEntity<Long> countOpenOrders(
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate periodStart,
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate periodEnd,
            @RequestHeader(value = "X-Tenant-Id", required = false) UUID tenantId) {
        if (tenantId != null && tenantContext.getTenantId().isEmpty()) {
            tenantContext.set(tenantId, null, null, null);
        }
        long count = orderRepository.countOpenOrdersByBusinessDateRange(periodStart, periodEnd);
        return ResponseEntity.ok(count);
    }
}
