package io.restaurantos.user.controller;

import io.restaurantos.shared.api.ApiResponse;
import io.restaurantos.user.dto.ReceiptConfigDtos.ReceiptConfig;
import io.restaurantos.user.dto.ReceiptConfigDtos.ReceiptConfigResponse;
import io.restaurantos.user.service.ReceiptConfigService;
import jakarta.validation.Valid;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.UUID;

/**
 * A branch's printer registry (D-26-05).
 *
 * <h2>Path</h2>
 *
 * <p>Nested under the existing branch resource — {@code /api/v1/branches/{branchId}/receipt-config}
 * — so the authority model is inherited rather than re-derived, and so the gateway's existing
 * {@code Path=/api/v1/branches/**} predicate already routes it. No gateway change was made and
 * {@code JwtGlobalFilter} was not touched; the POS live-order socket was only just repaired and
 * {@code WS_UPGRADE_PATHS} is not something to go near for a settings endpoint.
 *
 * <h2>Authority</h2>
 *
 * <p>Both the read and the write carry {@code pos.printers.admin} in addition to the two branch
 * administration authorities they shipped with.
 *
 * <p><b>Why the extra code, measured rather than argued.</b> The original expression was
 * byte-for-byte {@code BranchController}'s write gate, {@code hasAnyAuthority('rbac.manage',
 * 'branch.manage')}. {@code branch.manage}'s catalogue description is "Create, update and
 * deactivate branches", and it is held by OWNER and TENANT_ADMIN only. So the person who unboxes
 * the printer, plugs it into the kitchen switch and knows its address — the branch MANAGER — got a
 * 403 on their own branch's registry. Driven live against the running stack before this line was
 * changed. The answer is not to let a branch manager deactivate branches; it is to name the
 * decision that is actually being made. Printers are branch equipment catalogue, exactly like
 * dining tables ({@code pos.tables.admin}) and till profiles ({@code pos.terminals.admin}), and
 * {@code pos.printers.admin} is granted to the same three roles those two are — auth-service
 * changelog 088.
 *
 * <p>The two original authorities stay in the expression so that a stack whose auth migration has
 * not yet run does not lock an owner out of a screen they could already reach.
 *
 * <p>Note that this is STRICTER than {@code BranchController}'s read, which is open to any
 * authenticated user: this body carries the branch's internal network topology (agent URLs,
 * printer hosts and ports), which a cashier has no reason to enumerate.
 *
 * <h2>Not found vs forbidden</h2>
 *
 * <p>A branch id belonging to another tenant reaches {@code BranchService.get}, which is
 * RLS-scoped, and comes back as the same 404 every other branch operation returns for that case. A
 * new error code for an old condition would only teach clients a second thing to handle.
 */
@RestController
@RequestMapping("/api/v1/branches/{branchId}/receipt-config")
public class ReceiptConfigController {

    private final ReceiptConfigService receiptConfigService;

    public ReceiptConfigController(ReceiptConfigService receiptConfigService) {
        this.receiptConfigService = receiptConfigService;
    }

    /**
     * The stored registry, or an explicitly empty one. Never a 404 for "not configured yet" — the
     * caller must be able to tell an absence from a failure.
     */
    @PreAuthorize("hasAnyAuthority('rbac.manage', 'branch.manage', 'pos.printers.admin')")
    @GetMapping
    public ResponseEntity<ApiResponse<ReceiptConfigResponse>> read(@PathVariable UUID branchId) {
        return ResponseEntity.ok(ApiResponse.ok(receiptConfigService.read(branchId)));
    }

    /**
     * Replace the registry. Returns what was stored plus a completeness report naming any declared
     * kitchen station that no printer routes — saving an incomplete configuration is allowed,
     * saving one silently is not.
     */
    @PreAuthorize("hasAnyAuthority('rbac.manage', 'branch.manage', 'pos.printers.admin')")
    @PutMapping
    public ResponseEntity<ApiResponse<ReceiptConfigResponse>> write(
            @PathVariable UUID branchId,
            @Valid @RequestBody ReceiptConfig request) {
        return ResponseEntity.ok(ApiResponse.ok(receiptConfigService.write(branchId, request)));
    }
}
