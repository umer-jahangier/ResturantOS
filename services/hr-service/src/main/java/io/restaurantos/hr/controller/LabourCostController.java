package io.restaurantos.hr.controller;

import io.restaurantos.hr.service.LabourCostService;
import io.restaurantos.hr.service.LabourCostService.LabourCostByBranch;
import io.restaurantos.hr.service.LabourCostService.LabourCostByShift;
import io.restaurantos.shared.api.ApiResponse;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.UUID;

/** Labour-cost % metric (HR-06). Gated hr.payroll.view. Full reporting is Phase 12. */
@RestController
@RequestMapping("/api/v1/hr/labour-cost")
public class LabourCostController {

    private final LabourCostService labourCostService;

    public LabourCostController(LabourCostService labourCostService) {
        this.labourCostService = labourCostService;
    }

    @GetMapping("/branch/{branchId}")
    @PreAuthorize("hasAuthority('hr.payroll.view')")
    public ApiResponse<LabourCostByBranch> byBranch(@PathVariable UUID branchId,
                                                    @RequestParam int month, @RequestParam int year) {
        return ApiResponse.ok(labourCostService.labourCostByBranch(branchId, month, year));
    }

    @GetMapping("/shift/{shiftId}")
    @PreAuthorize("hasAuthority('hr.payroll.view')")
    public ApiResponse<LabourCostByShift> byShift(@PathVariable UUID shiftId,
                                                  @RequestParam int month, @RequestParam int year) {
        return ApiResponse.ok(labourCostService.labourCostByShift(shiftId, month, year));
    }
}
