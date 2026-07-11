package io.restaurantos.purchasing.web;

import io.restaurantos.purchasing.dto.SpendAnalyticsDto;
import io.restaurantos.purchasing.dto.VendorScorecardDto;
import io.restaurantos.purchasing.service.VendorAnalyticsService;
import io.restaurantos.shared.api.ApiResponse;
import io.restaurantos.shared.feature.RequiresFeature;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDate;
import java.util.UUID;

@RestController
@RequestMapping("/api/v1/purchasing/analytics")
@RequiresFeature("FEATURE_VENDOR")
public class VendorAnalyticsController {

    private final VendorAnalyticsService vendorAnalyticsService;

    public VendorAnalyticsController(VendorAnalyticsService vendorAnalyticsService) {
        this.vendorAnalyticsService = vendorAnalyticsService;
    }

    @GetMapping("/scorecard")
    public ApiResponse<VendorScorecardDto> scorecard(@RequestParam UUID vendorId,
                                                     @RequestParam UUID branchId) {
        return ApiResponse.ok(vendorAnalyticsService.scorecard(vendorId, branchId));
    }

    /** PUR-06: spend aggregated by vendor and by category over [from, to], with a prior-period comparison. */
    @GetMapping("/spend")
    public ApiResponse<SpendAnalyticsDto> spend(@RequestParam UUID branchId,
                                                @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
                                                @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to,
                                                @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate compareFrom,
                                                @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate compareTo) {
        return ApiResponse.ok(vendorAnalyticsService.spendReport(branchId, from, to, compareFrom, compareTo));
    }
}
