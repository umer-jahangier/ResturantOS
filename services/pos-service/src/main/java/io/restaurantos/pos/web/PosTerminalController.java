package io.restaurantos.pos.web;

import io.restaurantos.pos.dto.CreatePosTerminalRequest;
import io.restaurantos.pos.dto.PosTerminalDto;
import io.restaurantos.pos.dto.UpdatePosTerminalRequest;
import io.restaurantos.pos.service.PosTerminalService;
import io.restaurantos.shared.api.ApiResponse;
import io.restaurantos.shared.feature.RequiresFeature;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.UUID;

/**
 * Admin CRUD for POS terminal profiles (28-04, D-28-03) — the "dedicated POS selecting the
 * respective menu" the user asked for by name.
 *
 * <pre>
 *   GET    /api/v1/pos/terminals?branchId=&amp;includeInactive=   the branch's terminals
 *   GET    /api/v1/pos/terminals/{id}?branchId=                one terminal
 *   POST   /api/v1/pos/terminals?branchId=                     create
 *   PUT    /api/v1/pos/terminals/{id}?branchId=                rename / re-scope
 *   POST   /api/v1/pos/terminals/{id}/deactivate?branchId=     retire
 *   POST   /api/v1/pos/terminals/{id}/reactivate?branchId=     restore
 * </pre>
 *
 * <h2>There is no DELETE mapping, and that is not an oversight</h2>
 *
 * <p>From plan 28-12 {@code orders.terminal_id} references these rows, and a closed order must keep
 * naming the terminal it was taken on. Retirement is {@code POST /{id}/deactivate}, a POST to a
 * sub-resource rather than a DELETE, because a DELETE that does not delete is a trap for the next
 * person reading the route table. Same posture as the dining-table catalogue (19b).
 *
 * <h2>Gating</h2>
 *
 * <p>Writes require {@code pos.terminals.admin} (auth changeset 085, held by OWNER / TENANT_ADMIN /
 * MANAGER). Deliberately NOT {@code pos.menu.manage}: a terminal is not a menu, and phase 19b's
 * separation of {@code pos.tables.admin} from the waiter-held {@code pos.tables.manage} is the
 * precedent — verbs that share a noun and nothing else do not share a permission.
 *
 * <p>The READ is open to anyone who can view the menu or the KDS, because a POS screen has to be
 * able to ask which terminal it is. The retired-terminal view is a narrower thing and is gated
 * INSIDE the service rather than by an annotation here — see
 * {@code PosTerminalServiceImpl.list} for why the annotation form would leave the
 * {@code includeInactive} flag as an unguarded escalation.
 *
 * <p>{@code branchId} stays an explicit request parameter validated against the caller's verified
 * JWT branch inside the service, matching this service's existing controller convention. A second
 * convention would be worse than one imperfect consistent one.
 */
@RestController
@RequestMapping("/api/v1/pos/terminals")
@RequiresFeature("FEATURE_POS")
public class PosTerminalController {

    private final PosTerminalService terminalService;

    public PosTerminalController(PosTerminalService terminalService) {
        this.terminalService = terminalService;
    }

    @PreAuthorize("hasAnyAuthority('pos.menu.view','pos.kds.view','pos.terminals.admin')")
    @GetMapping
    public ResponseEntity<ApiResponse<List<PosTerminalDto>>> list(
            @RequestParam UUID branchId,
            @RequestParam(defaultValue = "false") boolean includeInactive) {
        return ResponseEntity.ok(ApiResponse.ok(terminalService.list(branchId, includeInactive)));
    }

    @PreAuthorize("hasAnyAuthority('pos.menu.view','pos.kds.view','pos.terminals.admin')")
    @GetMapping("/{id}")
    public ResponseEntity<ApiResponse<PosTerminalDto>> get(
            @PathVariable UUID id,
            @RequestParam UUID branchId) {
        return ResponseEntity.ok(ApiResponse.ok(terminalService.get(id, branchId)));
    }

    @PreAuthorize("hasAuthority('pos.terminals.admin')")
    @PostMapping
    public ResponseEntity<ApiResponse<PosTerminalDto>> create(
            @RequestParam UUID branchId,
            @Valid @RequestBody CreatePosTerminalRequest request) {
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(ApiResponse.ok(terminalService.create(branchId, request)));
    }

    @PreAuthorize("hasAuthority('pos.terminals.admin')")
    @PutMapping("/{id}")
    public ResponseEntity<ApiResponse<PosTerminalDto>> update(
            @PathVariable UUID id,
            @RequestParam UUID branchId,
            @Valid @RequestBody UpdatePosTerminalRequest request) {
        return ResponseEntity.ok(ApiResponse.ok(terminalService.update(id, branchId, request)));
    }

    /** Retire. Nothing is deleted — see the class javadoc. */
    @PreAuthorize("hasAuthority('pos.terminals.admin')")
    @PostMapping("/{id}/deactivate")
    public ResponseEntity<ApiResponse<PosTerminalDto>> deactivate(
            @PathVariable UUID id,
            @RequestParam UUID branchId) {
        return ResponseEntity.ok(ApiResponse.ok(terminalService.deactivate(id, branchId)));
    }

    @PreAuthorize("hasAuthority('pos.terminals.admin')")
    @PostMapping("/{id}/reactivate")
    public ResponseEntity<ApiResponse<PosTerminalDto>> reactivate(
            @PathVariable UUID id,
            @RequestParam UUID branchId) {
        return ResponseEntity.ok(ApiResponse.ok(terminalService.reactivate(id, branchId)));
    }
}
