package io.restaurantos.hr.controller.internal;

import io.restaurantos.hr.service.LabourCostService;
import io.restaurantos.hr.service.LabourCostService.LabourCostByBranch;
import io.restaurantos.shared.api.ApiResponse;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.UUID;

/**
 * Service-to-service labour-cost seam for Phase 12 reporting. Under /internal/hr/** it is
 * device/JWT-exempt but guarded by HrInternalServiceFilter (X-Internal-Service secret).
 */
@RestController
@RequestMapping("/internal/hr/labour-cost")
public class HrInternalController {

    private final LabourCostService labourCostService;

    public HrInternalController(LabourCostService labourCostService) {
        this.labourCostService = labourCostService;
    }

    @GetMapping("/branch/{branchId}")
    public ApiResponse<LabourCostByBranch> byBranch(@PathVariable UUID branchId,
                                                    @RequestParam int month, @RequestParam int year) {
        return ApiResponse.ok(labourCostService.labourCostByBranch(branchId, month, year));
    }
}
