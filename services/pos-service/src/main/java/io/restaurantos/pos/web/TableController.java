package io.restaurantos.pos.web;

import io.restaurantos.pos.domain.enums.TableStatus;
import io.restaurantos.pos.dto.DiningTableDto;
import io.restaurantos.pos.dto.TableDetailDto;
import io.restaurantos.pos.service.TableService;
import io.restaurantos.shared.api.ApiResponse;
import io.restaurantos.shared.feature.RequiresFeature;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;
import java.util.UUID;

@RestController
@RequestMapping("/api/v1/pos/tables")
@RequiresFeature("FEATURE_POS")
public class TableController {

    private final TableService tableService;

    public TableController(TableService tableService) {
        this.tableService = tableService;
    }

    @GetMapping
    public ResponseEntity<ApiResponse<List<DiningTableDto>>> listTables(@RequestParam UUID branchId) {
        List<DiningTableDto> tables = tableService.listByBranch(branchId).stream()
                .map(DiningTableDto::from)
                .toList();
        return ResponseEntity.ok(ApiResponse.ok(tables));
    }

    @PatchMapping("/{id}")
    public ResponseEntity<ApiResponse<DiningTableDto>> updateStatus(
            @PathVariable UUID id,
            @RequestParam UUID branchId,
            @RequestBody Map<String, String> body) {
        TableStatus status = TableStatus.valueOf(body.get("status"));
        return ResponseEntity.ok(ApiResponse.ok(DiningTableDto.from(tableService.updateStatus(id, branchId, status))));
    }

    @GetMapping("/{id}/active-order")
    public ResponseEntity<ApiResponse<TableDetailDto>> getActiveOrder(
            @PathVariable UUID id,
            @RequestParam UUID branchId) {
        return ResponseEntity.ok(ApiResponse.ok(tableService.getActiveOrderForTable(id, branchId)));
    }
}
