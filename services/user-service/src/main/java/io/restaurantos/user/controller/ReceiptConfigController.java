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
 * <p>Both the read and the write carry {@code hasAnyAuthority('rbac.manage', 'branch.manage')} —
 * byte-for-byte the expression {@code BranchController}'s write endpoints use. A user who may not
 * edit a branch may not decide where its receipts print. Note that this is STRICTER than
 * {@code BranchController}'s read, which is open to any authenticated user: this body carries the
 * branch's internal network topology (agent URLs, printer hosts and ports), which a cashier has no
 * reason to enumerate.
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
    @PreAuthorize("hasAnyAuthority('rbac.manage', 'branch.manage')")
    @GetMapping
    public ResponseEntity<ApiResponse<ReceiptConfigResponse>> read(@PathVariable UUID branchId) {
        return ResponseEntity.ok(ApiResponse.ok(receiptConfigService.read(branchId)));
    }

    /**
     * Replace the registry. Returns what was stored plus a completeness report naming any declared
     * kitchen station that no printer routes — saving an incomplete configuration is allowed,
     * saving one silently is not.
     */
    @PreAuthorize("hasAnyAuthority('rbac.manage', 'branch.manage')")
    @PutMapping
    public ResponseEntity<ApiResponse<ReceiptConfigResponse>> write(
            @PathVariable UUID branchId,
            @Valid @RequestBody ReceiptConfig request) {
        return ResponseEntity.ok(ApiResponse.ok(receiptConfigService.write(branchId, request)));
    }
}
