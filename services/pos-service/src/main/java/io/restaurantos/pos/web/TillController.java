package io.restaurantos.pos.web;

import io.restaurantos.pos.dto.CloseTillRequest;
import io.restaurantos.pos.dto.OpenTillRequest;
import io.restaurantos.pos.dto.TillReconciliationDto;
import io.restaurantos.pos.dto.TillSessionDto;
import io.restaurantos.pos.service.TillService;
import io.restaurantos.shared.api.ApiResponse;
import io.restaurantos.shared.feature.RequiresFeature;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.UUID;

@RestController
@RequestMapping("/api/v1/pos/tills")
@RequiresFeature("FEATURE_POS")
public class TillController {

    private final TillService tillService;

    public TillController(TillService tillService) {
        this.tillService = tillService;
    }

    @PostMapping
    public ResponseEntity<ApiResponse<TillSessionDto>> openTill(
            @Valid @RequestBody OpenTillRequest request) {
        TillSessionDto dto = tillService.openTill(request);
        return ResponseEntity.status(HttpStatus.CREATED).body(ApiResponse.ok(dto));
    }

    @PostMapping("/{id}/close")
    public ResponseEntity<ApiResponse<TillSessionDto>> closeTill(
            @PathVariable UUID id,
            @Valid @RequestBody CloseTillRequest request) {
        TillSessionDto dto = tillService.closeTill(id, request);
        return ResponseEntity.ok(ApiResponse.ok(dto));
    }

    @GetMapping("/{id}")
    public ResponseEntity<ApiResponse<TillSessionDto>> getTill(@PathVariable UUID id) {
        TillSessionDto dto = tillService.getTill(id);
        return ResponseEntity.ok(ApiResponse.ok(dto));
    }

    @GetMapping
    public ResponseEntity<ApiResponse<List<TillSessionDto>>> listTills(
            @RequestParam(required = false) UUID cashierId,
            @RequestParam(required = false) UUID branchId,
            @RequestParam(required = false) String status) {
        // branchId → admin till-review history (all sessions, newest first); otherwise the
        // legacy cashier-scoped lookup (used by the active-till bar).
        List<TillSessionDto> dtos = branchId != null
                ? tillService.listTillsForBranch(branchId)
                : tillService.listTills(cashierId, status);
        return ResponseEntity.ok(ApiResponse.ok(dtos));
    }

    /** Admin till-review: the session + every order within it + cash/non-cash collected. */
    @GetMapping("/{id}/reconciliation")
    public ResponseEntity<ApiResponse<TillReconciliationDto>> getReconciliation(@PathVariable UUID id) {
        return ResponseEntity.ok(ApiResponse.ok(tillService.getReconciliation(id)));
    }
}
