package io.restaurantos.purchasing.web;

import io.restaurantos.purchasing.dto.VendorScorecardDto;
import io.restaurantos.purchasing.service.VendorAnalyticsService;
import io.restaurantos.shared.api.ApiResponse;
import io.restaurantos.shared.feature.RequiresFeature;
import org.springframework.web.bind.annotation.*;

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
}
