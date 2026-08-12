package io.restaurantos.pos.web;

import io.restaurantos.pos.dto.InternalOrderSummaryDto;
import io.restaurantos.pos.dto.StationDto;
import io.restaurantos.pos.repository.OrderRepository;
import io.restaurantos.pos.repository.StationRepository;
import io.restaurantos.pos.service.MenuService;
import io.restaurantos.shared.tenant.TenantContext;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDate;
import java.util.List;
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
    private final StationRepository stationRepository;

    public InternalPosController(OrderRepository orderRepository, TenantContext tenantContext,
                                  MenuService menuService, StationRepository stationRepository) {
        this.orderRepository = orderRepository;
        this.tenantContext = tenantContext;
        this.menuService = menuService;
        this.stationRepository = stationRepository;
    }

    /**
     * The branch's station REGISTRY — pos-service owns {@code stations} (admin CRUD at
     * {@code /app/stations}), and this is the seam kitchen-service reads it through so its
     * {@code kds_stations} projection stops being built lazily out of ticket traffic.
     *
     * <p><b>Why this endpoint exists at all.</b> Before it, a station only became visible on the
     * KDS when its FIRST TICKET arrived — {@code TicketRoutingService.upsertStation} was the only
     * writer of {@code kds_stations}. So an admin could create PANTRY1, and the pantry screen and
     * the pantry cook's station picker would both insist no such station existed until somebody
     * happened to ring a pantry item. Measured live at branch F-7: pos held 5 stations, the KDS
     * listed 3, and one of those 3 (DEFAULT) does not exist in pos at all.
     *
     * <p>ACTIVE AND INACTIVE rows are returned, deliberately. A deactivated station is not the
     * same as a station that was never created, and the consumer needs the difference to retire
     * its own projected row rather than leaving a dead board on the wall forever.
     *
     * <p>Tenant scoping is by the explicit {@code tenantId} predicate AND by RLS via the tenant
     * context, exactly as the two order endpoints above. {@code branchId} is a plain parameter
     * here — there is no JWT to check it against on an internal call, and the caller
     * (kitchen-service) has already authorized the branch against the user's token before asking.
     *
     * @return bare list (NOT ApiResponse-wrapped) — mirrors this controller's existing contract
     */
    @GetMapping("/stations")
    public ResponseEntity<List<StationDto>> listStations(
            @RequestParam UUID branchId,
            @RequestHeader(value = "X-Tenant-Id", required = false) UUID tenantId) {
        if (tenantId != null && tenantContext.getTenantId().isEmpty()) {
            tenantContext.set(tenantId, null, null, null);
        }
        UUID scopedTenantId = tenantContext.requireTenantId();
        List<StationDto> stations = stationRepository
                .findByTenantIdAndBranchId(scopedTenantId, branchId)
                .stream()
                .map(StationDto::from)
                .toList();
        return ResponseEntity.ok(stations);
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
     * Order summary for finance's journal-entry source reference (37-04, D-37-01).
     *
     * <p>Returns 404 when the order is not visible, which finance turns into an explicit
     * "could not be read" state rather than a fabricated reference — see
     * {@code SourceReferenceResolver}. Tenant scoping is by RLS via the tenant filter, exactly
     * as the open-count endpoint above.
     *
     * @return bare DTO (NOT ApiResponse-wrapped) — mirrors this controller's existing contract
     */
    @GetMapping("/orders/{orderId}/summary")
    public ResponseEntity<InternalOrderSummaryDto> getOrderSummary(
            @PathVariable UUID orderId,
            @RequestHeader(value = "X-Tenant-Id", required = false) UUID tenantId) {
        if (tenantId != null && tenantContext.getTenantId().isEmpty()) {
            tenantContext.set(tenantId, null, null, null);
        }
        return orderRepository.findById(orderId)
                .map(o -> ResponseEntity.ok(new InternalOrderSummaryDto(
                        o.getId(), o.getOrderNo(), o.getBranchId(), o.getCashierId(), o.getClosedAt())))
                .orElseGet(() -> ResponseEntity.notFound().build());
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
