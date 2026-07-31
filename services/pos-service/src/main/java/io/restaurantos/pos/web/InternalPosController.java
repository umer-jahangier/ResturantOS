package io.restaurantos.pos.web;

import io.restaurantos.pos.repository.OrderRepository;
import io.restaurantos.pos.service.MenuService;
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
    private final MenuService menuService;

    public InternalPosController(OrderRepository orderRepository, TenantContext tenantContext,
                                  MenuService menuService) {
        this.orderRepository = orderRepository;
        this.tenantContext = tenantContext;
        this.menuService = menuService;
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

    /**
     * D-05 backfill: re-emits MENU_ITEM_UPSERTED for every currently-active menu item in the
     * resolved tenant, so pre-existing (e.g. seeded) menu items — which never went through the
     * new write path — enter inventory-service's menu_item_catalog read-model (08.1-02). Already
     * covered by PosInternalServiceFilter's existing {@code /internal/**} X-Internal-Service
     * secret guard — no new security wiring needed.
     *
     * @return bare Long (NOT ApiResponse-wrapped) — mirrors this controller's existing contract
     */
    @PostMapping("/menu-items/republish")
    public ResponseEntity<Long> republishMenuItems(
            @RequestHeader(value = "X-Tenant-Id", required = false) UUID tenantId) {
        if (tenantId != null && tenantContext.getTenantId().isEmpty()) {
            tenantContext.set(tenantId, null, null, null);
        }
        long count = menuService.republishAllActive();
        return ResponseEntity.ok(count);
    }
}
