package io.restaurantos.pos.web;

import io.restaurantos.pos.domain.enums.TableStatus;
import io.restaurantos.pos.domain.model.DiningTable;
import io.restaurantos.pos.service.TableService;
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
    public ResponseEntity<List<DiningTable>> listTables(@RequestParam UUID branchId) {
        return ResponseEntity.ok(tableService.listByBranch(branchId));
    }

    @PatchMapping("/{id}")
    public ResponseEntity<DiningTable> updateStatus(
            @PathVariable UUID id,
            @RequestParam UUID branchId,
            @RequestBody Map<String, String> body) {
        TableStatus status = TableStatus.valueOf(body.get("status"));
        return ResponseEntity.ok(tableService.updateStatus(id, branchId, status));
    }
}
