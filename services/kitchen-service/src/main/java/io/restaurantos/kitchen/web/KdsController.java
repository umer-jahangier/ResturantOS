package io.restaurantos.kitchen.web;

import io.restaurantos.kitchen.authz.KdsAuthorizationService;
import io.restaurantos.kitchen.authz.StationScope;
import io.restaurantos.kitchen.domain.enums.TicketItemStatus;
import io.restaurantos.kitchen.domain.enums.TicketStatus;
import io.restaurantos.kitchen.domain.model.KdsStation;
import io.restaurantos.kitchen.domain.model.StationType;
import io.restaurantos.kitchen.dto.KdsTicketDto;
import io.restaurantos.kitchen.repository.KdsStationRepository;
import io.restaurantos.kitchen.repository.KdsTicketRepository;
import io.restaurantos.kitchen.service.StationRegistryService;
import io.restaurantos.kitchen.service.TicketService;
import io.restaurantos.kitchen.service.TicketServiceImpl;
import io.restaurantos.shared.api.ApiResponse;
import io.restaurantos.shared.exception.PermissionDeniedException;
import io.restaurantos.shared.feature.RequiresFeature;
import io.restaurantos.shared.security.JwtClaims;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.http.HttpStatus;
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
    private final StationRegistryService stationRegistry;

    public KdsController(KdsAuthorizationService authz,
                          KdsTicketRepository ticketRepository,
                          KdsStationRepository stationRepository,
                          TicketServiceImpl ticketService,
                          StationRegistryService stationRegistry) {
        this.authz = authz;
        this.ticketRepository = ticketRepository;
        this.stationRepository = stationRepository;
        this.ticketService = ticketService;
        this.stationRegistry = stationRegistry;
    }

    /**
     * List open tickets for a branch/station.
     * Requires pos.kds.view permission (OPA evaluated).
     */
    @GetMapping("/tickets")
    public ResponseEntity<Page<KdsTicketDto>> getTickets(
            @RequestParam UUID branchId,
            @RequestParam(required = false) String stationCode,
            @RequestParam(required = false, defaultValue = "PENDING,COOKING,READY") String status,
            @AuthenticationPrincipal JwtClaims claims,
            Pageable pageable) {

        authz.authorizeView(claims.tenantId(), branchId);

        List<TicketStatus> statuses = List.of(status.split(",")).stream()
                .map(String::trim)
                .map(TicketStatus::valueOf)
                .toList();
        // The caller's station scope (28-07, D-28-02), resolved AFTER authorizeView above.
        // Identity first, scope second — a scope check that ran first would be deciding what a
        // caller may see before establishing who the caller is.
        //
        // UNRESTRICTED is the overwhelmingly common case and takes the byte-identical path this
        // endpoint has always taken, including the station-less branch-wide board, which is a
        // working pass view whether or not it was designed as one.
        StationScope scope = authz.resolveStationScope();

        Page<KdsTicketDto> result;
        if (stationCode != null) {
            if (!scope.permits(stationCode)) {
                // An EMPTY PAGE, not a 403. An empty board is the honest answer to "show me a
                // station I do not work", and a distinct error status would let a cook enumerate
                // which stations exist at the branch by watching which requests 403.
                result = Page.empty(pageable);
            } else {
                result = ticketRepository
                        .findByBranchIdAndStationCodeAndStatusIn(branchId, stationCode, statuses, pageable)
                        .map(ticketService::toDto);
            }
        } else if (scope.isUnrestricted()) {
            // No stationCode → branch-wide active board (station-stats screen). Uses a
            // branch+status scoped, item-eager query — never findAll (which leaked across tenants
            // and threw on lazy items).
            result = ticketRepository.findByBranchIdAndStatusIn(branchId, statuses, pageable)
                    .map(ticketService::toDto);
        } else {
            result = ticketRepository
                    .findByBranchIdAndStationCodeInAndStatusIn(
                            branchId, scope.permittedCodes(), statuses, pageable)
                    .map(ticketService::toDto);
        }

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
        KdsTicketDto ticket = ticketService.getTicketDetail(ticketId);
        // Detail REFUSES rather than returning empty, unlike the list. The difference is
        // deliberate: here a specific resource is being named, and handing back a ticket the
        // caller may not see is the actual disclosure. On the list, an empty page is the honest
        // answer and a 403 would be an enumeration oracle.
        if (!authz.resolveStationScope().permits(ticket.stationCode())) {
            throw new PermissionDeniedException("Ticket is not at a station assigned to this user");
        }
        return ResponseEntity.ok(ApiResponse.ok(ticket));
    }

    /**
     * List active stations for a branch, from the branch's REGISTRY.
     *
     * <h3>What changed and why the old behaviour was a defect</h3>
     *
     * <p>This used to auto-seed a {@code DEFAULT} row whenever the query came back empty, "so the
     * board is never empty". It was the wrong answer to the right worry. The list was empty because
     * {@code kds_stations} had exactly one writer — the ticket-routing path — so a station existed
     * on the KDS only once its first ticket had landed. An admin who created PANTRY1 got no pantry
     * board, the pantry cook got "No active stations configured", and the auto-seed then invented a
     * station that exists in no registry anywhere so the screen would look healthy while being
     * wrong. Measured at branch F-7: pos held BAR, GRILL, DGB28334, DGS43431, DGS20334; this
     * endpoint returned DEFAULT, GRILL, BAR.
     *
     * <p>So the registry is now synced from pos-service (which owns station CRUD) BEFORE the read,
     * and the auto-seed is gone. A branch that genuinely has no stations now says so, which is
     * true and actionable — the admin creates one at {@code /app/stations}. A branch whose
     * registry could not be READ says {@code 503}, which is also true, and is emphatically not the
     * same sentence as "you have no stations".
     *
     * <p>Requires pos.kds.view permission (OPA evaluated).
     */
    @GetMapping("/stations")
    public ResponseEntity<List<KdsStation>> getStations(
            @RequestParam UUID branchId,
            @RequestParam(required = false) StationType stationType,
            @AuthenticationPrincipal JwtClaims claims) {

        authz.authorizeView(claims.tenantId(), branchId);

        // Registry sync FIRST, so a station created seconds ago at /app/stations is on this
        // response — the whole point. Never fatal: an unreachable pos-service leaves the existing
        // projection in place and the kitchen keeps the board it had.
        StationRegistryService.SyncOutcome outcome =
                stationRegistry.syncBranch(claims.tenantId(), branchId);

        // Unfiltered is the default and is byte-identical to what this endpoint has always
        // returned, so the existing board is unaffected. No feature flag: /api/v1/kitchen/ already
        // gates on FEATURE_KDS and FEATURE_KDS is on for every tier — a code no tier grants
        // produces a confident 403 for everyone, which this repository has shipped twice.
        List<KdsStation> stations = stationType != null
                ? stationRepository.findByBranchIdAndActiveTrueAndStationType(branchId, stationType)
                : stationRepository.findByBranchIdAndActiveTrue(branchId);

        if (stations.isEmpty() && outcome == StationRegistryService.SyncOutcome.REGISTRY_UNAVAILABLE) {
            // The one case that must NOT render as an empty board: we have no projected stations
            // AND we could not read the registry, so we do not know whether this branch has none
            // or whether pos-service is restarting. 503 makes the KDS show its error state with a
            // retry instead of telling a kitchen, in the product's confident voice, that it has no
            // stations. GA-001, on the kitchen's front door.
            return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE).build();
        }

        // Narrowed to the caller's own stations (28-07, D-28-02) — AFTER the registry sync, and the
        // order is load-bearing. Filtering first would make a bartender at a branch with only
        // kitchen stations look like a branch with NO stations.
        //
        // An unassigned caller keeps the whole list, which is what every user in the product has
        // today.
        StationScope scope = authz.resolveStationScope();
        if (!scope.isUnrestricted()) {
            stations = stations.stream().filter(st -> scope.permits(st.getCode())).toList();
        }
        return ResponseEntity.ok(stations);
    }
}
