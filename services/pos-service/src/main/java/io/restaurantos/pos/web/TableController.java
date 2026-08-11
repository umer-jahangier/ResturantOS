package io.restaurantos.pos.web;

import io.restaurantos.pos.domain.enums.TableStatus;
import io.restaurantos.pos.dto.DiningTableDto;
import io.restaurantos.pos.dto.TableAdminDtos.CreateDiningTableRequest;
import io.restaurantos.pos.dto.TableAdminDtos.UpdateDiningTableRequest;
import io.restaurantos.pos.dto.TableDetailDto;
import io.restaurantos.pos.service.TableService;
import io.restaurantos.shared.api.ApiResponse;
import io.restaurantos.shared.feature.RequiresFeature;
import jakarta.validation.Valid;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * <h2>Two permissions, not one</h2>
 *
 * <p>Reads and status changes stay on the permissions they always had — {@code pos.order.view}
 * and {@code pos.tables.manage}, both of which a WAITER holds, because a waiter who cannot see
 * or seat a table cannot work a floor. Everything that changes which tables the restaurant HAS
 * is gated on {@code pos.tables.admin} (new in 19b-01), which a waiter does not hold.
 *
 * <p>The {@code includeInactive} flag on the list endpoint is gated inside the service rather
 * than here: a method-level {@code @PreAuthorize} would have to be the weaker of the two
 * permissions for the waiter's picker to keep working, which would leave the flag itself as an
 * unguarded escalation to the catalogue view. See {@code TableServiceImpl#listByBranch}.
 */
@RestController
@RequestMapping("/api/v1/pos/tables")
@RequiresFeature("FEATURE_POS")
public class TableController {

    private final TableService tableService;

    public TableController(TableService tableService) {
        this.tableService = tableService;
    }

    /**
     * @param includeInactive service default {@code false} — a retired table must never appear
     *                        in the picker a waiter uses mid-order. {@code true} is the
     *                        management screen and requires {@code pos.tables.admin}.
     */
    @PreAuthorize("hasAuthority('pos.order.view')")
    @GetMapping
    public ResponseEntity<ApiResponse<List<DiningTableDto>>> listTables(
            @RequestParam UUID branchId,
            @RequestParam(required = false, defaultValue = "false") boolean includeInactive) {
        List<DiningTableDto> tables = tableService.listByBranch(branchId, includeInactive).stream()
                .map(DiningTableDto::from)
                .toList();
        return ResponseEntity.ok(ApiResponse.ok(tables));
    }

    @PreAuthorize("hasAuthority('pos.tables.admin')")
    @PostMapping
    public ResponseEntity<ApiResponse<DiningTableDto>> createTable(
            @RequestParam UUID branchId,
            @Valid @RequestBody CreateDiningTableRequest request) {
        DiningTableDto created = DiningTableDto.from(tableService.create(branchId, request));
        return ResponseEntity.status(HttpStatus.CREATED).body(ApiResponse.ok(created));
    }

    @PreAuthorize("hasAuthority('pos.tables.admin')")
    @PutMapping("/{id}")
    public ResponseEntity<ApiResponse<DiningTableDto>> updateTable(
            @PathVariable UUID id,
            @RequestParam UUID branchId,
            @Valid @RequestBody UpdateDiningTableRequest request) {
        return ResponseEntity.ok(ApiResponse.ok(
                DiningTableDto.from(tableService.update(id, branchId, request))));
    }

    /**
     * Reactivate a retired table. There is no DELETE counterpart anywhere on this controller
     * and there will not be one: {@code orders.table_id} references these rows, so a closed
     * order must keep naming the table it was served at.
     */
    @PreAuthorize("hasAuthority('pos.tables.admin')")
    @PatchMapping("/{id}/activate")
    public ResponseEntity<ApiResponse<DiningTableDto>> activateTable(
            @PathVariable UUID id,
            @RequestParam UUID branchId) {
        return ResponseEntity.ok(ApiResponse.ok(
                DiningTableDto.from(tableService.setActive(id, branchId, true))));
    }

    @PreAuthorize("hasAuthority('pos.tables.admin')")
    @PatchMapping("/{id}/deactivate")
    public ResponseEntity<ApiResponse<DiningTableDto>> deactivateTable(
            @PathVariable UUID id,
            @RequestParam UUID branchId) {
        return ResponseEntity.ok(ApiResponse.ok(
                DiningTableDto.from(tableService.setActive(id, branchId, false))));
    }

    /** Runtime seat/release — {@code pos.tables.manage}, which a WAITER holds by design. */
    @PreAuthorize("hasAuthority('pos.tables.manage')")
    @PatchMapping("/{id}")
    public ResponseEntity<ApiResponse<DiningTableDto>> updateStatus(
            @PathVariable UUID id,
            @RequestParam UUID branchId,
            @RequestBody Map<String, String> body) {
        TableStatus status = TableStatus.valueOf(body.get("status"));
        return ResponseEntity.ok(ApiResponse.ok(DiningTableDto.from(tableService.updateStatus(id, branchId, status))));
    }

    @PreAuthorize("hasAuthority('pos.order.view')")
    @GetMapping("/{id}/active-order")
    public ResponseEntity<ApiResponse<TableDetailDto>> getActiveOrder(
            @PathVariable UUID id,
            @RequestParam UUID branchId) {
        return ResponseEntity.ok(ApiResponse.ok(tableService.getActiveOrderForTable(id, branchId)));
    }
}
