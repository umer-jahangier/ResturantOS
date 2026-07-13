package io.restaurantos.finance.web;

import io.restaurantos.finance.domain.enums.ExpenseStatus;
import io.restaurantos.finance.dto.CreateExpenseRequest;
import io.restaurantos.finance.dto.ExpenseDto;
import io.restaurantos.finance.service.ExpenseService;
import io.restaurantos.shared.api.ApiResponse;
import io.restaurantos.shared.feature.RequiresFeature;
import jakarta.validation.Valid;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * FIN-05: expense create/approve/reject. approve() consumes the
 * finance.expense.approve RBAC permission (seeded in auth-service with zero
 * prior consumers) AND is gated by an OPA approval-limit check in ExpenseService.
 */
@RestController
@RequestMapping("/api/v1/finance/expenses")
@RequiresFeature("FEATURE_FINANCE")
public class ExpenseController {

    private final ExpenseService expenseService;

    public ExpenseController(ExpenseService expenseService) {
        this.expenseService = expenseService;
    }

    @PostMapping
    @PreAuthorize("hasAuthority('finance.journal.post')")
    public ApiResponse<ExpenseDto> create(@Valid @RequestBody CreateExpenseRequest req) {
        return ApiResponse.ok(expenseService.create(req));
    }

    @GetMapping
    @PreAuthorize("hasAuthority('finance.journal.view')")
    public ApiResponse<List<ExpenseDto>> list(@RequestParam UUID branchId,
                                              @RequestParam(required = false) List<ExpenseStatus> status) {
        return ApiResponse.ok(expenseService.list(branchId, status));
    }

    @GetMapping("/{id}")
    @PreAuthorize("hasAuthority('finance.journal.view')")
    public ApiResponse<ExpenseDto> get(@PathVariable UUID id) {
        return ApiResponse.ok(expenseService.getById(id));
    }

    @PostMapping("/{id}/approve")
    @PreAuthorize("hasAuthority('finance.expense.approve')")
    public ApiResponse<ExpenseDto> approve(@PathVariable UUID id) {
        return ApiResponse.ok(expenseService.approve(id));
    }

    @PostMapping("/{id}/reject")
    @PreAuthorize("hasAuthority('finance.expense.approve')")
    public ApiResponse<ExpenseDto> reject(@PathVariable UUID id, @RequestBody Map<String, String> body) {
        return ApiResponse.ok(expenseService.reject(id, body.get("reason")));
    }
}
