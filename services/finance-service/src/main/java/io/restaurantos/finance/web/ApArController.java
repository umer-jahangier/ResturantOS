package io.restaurantos.finance.web;

import io.restaurantos.finance.dto.ApAgingReportDto;
import io.restaurantos.finance.service.ApAgingService;
import io.restaurantos.shared.api.ApiResponse;
import io.restaurantos.shared.feature.RequiresFeature;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDate;
import java.util.UUID;

@RestController
@RequestMapping("/api/v1/finance/ap")
@RequiresFeature("FEATURE_FINANCE")
public class ApArController {

    private final ApAgingService apAgingService;

    public ApArController(ApAgingService apAgingService) {
        this.apAgingService = apAgingService;
    }

    @GetMapping("/aging")
    @PreAuthorize("hasAuthority('finance.journal.view')")
    public ApiResponse<ApAgingReportDto> aging(
            @RequestParam UUID branchId,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate asOf) {
        LocalDate date = asOf != null ? asOf : LocalDate.now();
        return ApiResponse.ok(apAgingService.getAging(branchId, date));
    }
}
