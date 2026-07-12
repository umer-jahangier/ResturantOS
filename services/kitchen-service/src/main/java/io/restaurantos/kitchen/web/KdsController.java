package io.restaurantos.kitchen.web;

import io.restaurantos.kitchen.authz.KdsAuthorizationService;
import io.restaurantos.kitchen.domain.enums.TicketItemStatus;
import io.restaurantos.kitchen.domain.enums.TicketStatus;
import io.restaurantos.kitchen.domain.model.KdsStation;
import io.restaurantos.kitchen.dto.KdsTicketDto;
import io.restaurantos.kitchen.repository.KdsStationRepository;
import io.restaurantos.kitchen.repository.KdsTicketRepository;
import io.restaurantos.kitchen.service.TicketService;
import io.restaurantos.kitchen.service.TicketServiceImpl;
import io.restaurantos.shared.api.ApiResponse;
import io.restaurantos.shared.feature.RequiresFeature;
import io.restaurantos.shared.security.JwtClaims;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.UUID;

@RestController
@RequestMapping("/api/v1/kitchen/kds")
@RequiresFeature("FEATURE_KDS")
public class KdsController {

    private final KdsAuthorizationService authz;
    private final KdsTicketRepository ticketRepository;
    private final KdsStationRepository stationRepository;
    private final TicketServiceImpl ticketService;

    public KdsController(KdsAuthorizationService authz,
                          KdsTicketRepository ticketRepository,
                          KdsStationRepository stationRepository,
                          TicketServiceImpl ticketService) {
        this.authz = authz;
        this.ticketRepository = ticketRepository;
        this.stationRepository = stationRepository;
        this.ticketService = ticketService;
    }

    /**
     * List open tickets for a branch/station.
     * Requires pos.kds.view permission (OPA evaluated).
     */
    @GetMapping("/tickets")
    public ResponseEntity<Page<KdsTicketDto>> getTickets(
            @RequestParam UUID branchId,
            @RequestParam(required = false) String stationCode,
            @RequestParam(required = false, defaultValue = "PENDING,COOKING") String status,
            @AuthenticationPrincipal JwtClaims claims,
            Pageable pageable) {

        authz.authorizeView(claims.tenantId(), branchId);

        List<TicketStatus> statuses = List.of(status.split(",")).stream()
                .map(String::trim)
                .map(TicketStatus::valueOf)
                .toList();
        Page<KdsTicketDto> result = (stationCode != null)
                ? ticketRepository.findByBranchIdAndStationCodeAndStatusIn(branchId, stationCode, statuses, pageable)
                        .map(ticketService::toDto)
                : ticketRepository.findAll(pageable).map(ticketService::toDto);

        return ResponseEntity.ok(result);
    }

    /**
     * Bump a ticket item: PENDING->COOKING or COOKING->READY.
     * Requires pos.kds.update permission (OPA evaluated).
     */
    @PostMapping("/tickets/{ticketId}/items/{itemId}/bump")
    public ResponseEntity<KdsTicketDto> bumpItem(
            @PathVariable UUID ticketId,
            @PathVariable UUID itemId,
            @RequestParam UUID branchId,
            @AuthenticationPrincipal JwtClaims claims) {

        authz.authorizeUpdate(claims.tenantId(), branchId);
        return ResponseEntity.ok(ticketService.bumpItem(ticketId, itemId));
    }

    /**
     * Explicit item-status transition endpoint (KDS-04, D-12): drives the New(PENDING)->
     * Started(ACCEPTED)->Preparing(PREPARING)->Ready(READY) lifecycle in a single wrapping
     * call to {@link io.restaurantos.kitchen.service.TicketService#markItemStatus}, so every
     * endpoint-driven transition also inherits the KITCHEN_ITEM_STATUS_CHANGED pos-sync
     * event emit (07.3-02) — this endpoint never re-implements transition logic itself.
     * Requires pos.kds.update permission (OPA evaluated).
     */
    @PostMapping("/tickets/{ticketId}/items/{itemId}/status")
    public ResponseEntity<KdsTicketDto> setItemStatus(
            @PathVariable UUID ticketId,
            @PathVariable UUID itemId,
            @RequestParam UUID branchId,
            @RequestBody ItemStatusRequest request,
            @AuthenticationPrincipal JwtClaims claims) {

        authz.authorizeUpdate(claims.tenantId(), branchId);
        return ResponseEntity.ok(ticketService.markItemStatus(ticketId, itemId, request.status()));
    }

    public record ItemStatusRequest(TicketItemStatus status) {}

    /**
     * Recall a READY ticket back to COOKING (e.g. mistake by kitchen).
     * Requires pos.kds.update permission (OPA evaluated).
     */
    @PostMapping("/tickets/{ticketId}/recall")
    public ResponseEntity<KdsTicketDto> recallTicket(
            @PathVariable UUID ticketId,
            @RequestParam UUID branchId,
            @AuthenticationPrincipal JwtClaims claims) {

        authz.authorizeUpdate(claims.tenantId(), branchId);
        return ResponseEntity.ok(ticketService.recallTicket(ticketId));
    }

    /**
     * Full ticket detail (all items, per-item status + revisionNo + firedAt) for the KDS
     * "open a ticket for full order detail" view (KDS-03).
     * Requires pos.kds.view permission (OPA evaluated).
     */
    @GetMapping("/tickets/{ticketId}")
    public ResponseEntity<ApiResponse<KdsTicketDto>> getTicketDetail(
            @PathVariable UUID ticketId,
            @RequestParam UUID branchId,
            @AuthenticationPrincipal JwtClaims claims) {

        authz.authorizeView(claims.tenantId(), branchId);
        return ResponseEntity.ok(ApiResponse.ok(ticketService.getTicketDetail(ticketId)));
    }

    /**
     * List active stations for a branch.
     * Requires pos.kds.view permission (OPA evaluated).
     */
    @GetMapping("/stations")
    public ResponseEntity<List<KdsStation>> getStations(
            @RequestParam UUID branchId,
            @AuthenticationPrincipal JwtClaims claims) {

        authz.authorizeView(claims.tenantId(), branchId);
        return ResponseEntity.ok(stationRepository.findByBranchIdAndActiveTrue(branchId));
    }
}
