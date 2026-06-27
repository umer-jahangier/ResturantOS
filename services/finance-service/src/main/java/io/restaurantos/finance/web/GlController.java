package io.restaurantos.finance.web;

import io.restaurantos.finance.dto.GlBalanceDto;
import io.restaurantos.finance.dto.JournalLineDto;
import io.restaurantos.finance.service.GlService;
import io.restaurantos.shared.api.ApiResponse;
import io.restaurantos.shared.api.PageMeta;
import io.restaurantos.shared.tenant.TenantContext;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.web.PageableDefault;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.UUID;

@RestController
@RequestMapping("/api/v1/finance/gl")
public class GlController {

    private final GlService glService;
    private final TenantContext tenantContext;

    public GlController(GlService glService, TenantContext tenantContext) {
        this.glService = glService;
        this.tenantContext = tenantContext;
    }

    @GetMapping({"/balances", ""})
    @PreAuthorize("hasAuthority('finance.journal.view')")
    public ResponseEntity<ApiResponse<List<GlBalanceDto>>> getBalances(@RequestParam UUID periodId) {
        UUID branchId = requireBranchId();
        return ResponseEntity.ok(ApiResponse.ok(glService.getGlBalances(periodId, branchId)));
    }

    @GetMapping("/{accountCode}/entries")
    @PreAuthorize("hasAuthority('finance.journal.view')")
    public ResponseEntity<ApiResponse<List<JournalLineDto>>> getEntries(
            @PathVariable String accountCode,
            @RequestParam UUID periodId,
            @PageableDefault(size = 50) Pageable pageable) {
        UUID branchId = requireBranchId();
        Page<JournalLineDto> page =
                glService.getGlEntries(accountCode, periodId, branchId, pageable);
        return ResponseEntity.ok(ApiResponse.paginated(page.getContent(), new PageMeta(
                new PageMeta.Page(
                        String.valueOf(page.getNumber()),
                        page.hasNext() ? String.valueOf(page.getNumber() + 1) : null,
                        page.getSize()),
                page.getTotalElements())));
    }

    private UUID requireBranchId() {
        return tenantContext.getBranchId()
                .orElseThrow(() -> new IllegalStateException("Branch context required"));
    }
}
