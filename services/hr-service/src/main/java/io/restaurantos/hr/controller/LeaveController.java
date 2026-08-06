package io.restaurantos.hr.controller;

import io.restaurantos.hr.service.LeaveService;
import io.restaurantos.hr.service.LeaveService.BalanceResponse;
import io.restaurantos.hr.service.LeaveService.CreateTypeRequest;
import io.restaurantos.hr.service.LeaveService.LeaveRequestResponse;
import io.restaurantos.hr.service.LeaveService.RequestLeave;
import io.restaurantos.hr.service.LeaveService.TypeResponse;
import io.restaurantos.shared.api.ApiResponse;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.UUID;

/** Leave workflow. Requests/reads gated hr.leave.view; approve/reject hr.leave.approve; type + accrual admin hr.attendance.manage. */
@RestController
@RequestMapping("/api/v1/hr/leave")
public class LeaveController {

    private final LeaveService leaveService;

    public LeaveController(LeaveService leaveService) {
        this.leaveService = leaveService;
    }

    @PostMapping("/requests")
    @ResponseStatus(HttpStatus.CREATED)
    @PreAuthorize("hasAuthority('hr.leave.view')")
    public ApiResponse<LeaveRequestResponse> request(@RequestBody RequestLeave req) {
        return ApiResponse.ok(leaveService.request(req));
    }

    @PostMapping("/requests/{id}/approve")
    @PreAuthorize("hasAuthority('hr.leave.approve')")
    public ApiResponse<LeaveRequestResponse> approve(@PathVariable UUID id) {
        return ApiResponse.ok(leaveService.approve(id));
    }

    @PostMapping("/requests/{id}/reject")
    @PreAuthorize("hasAuthority('hr.leave.approve')")
    public ApiResponse<LeaveRequestResponse> reject(@PathVariable UUID id) {
        return ApiResponse.ok(leaveService.reject(id));
    }

    @GetMapping("/balances")
    @PreAuthorize("hasAuthority('hr.leave.view')")
    public ApiResponse<List<BalanceResponse>> balances(@RequestParam UUID employeeId) {
        return ApiResponse.ok(leaveService.balances(employeeId));
    }

    @GetMapping("/types")
    @PreAuthorize("hasAuthority('hr.leave.view')")
    public ApiResponse<List<TypeResponse>> listTypes() {
        return ApiResponse.ok(leaveService.listTypes());
    }

    @PostMapping("/types")
    @ResponseStatus(HttpStatus.CREATED)
    @PreAuthorize("hasAuthority('hr.attendance.manage')")
    public ApiResponse<TypeResponse> createType(@RequestBody CreateTypeRequest req) {
        return ApiResponse.ok(leaveService.createType(req));
    }

    @PostMapping("/types/defaults")
    @PreAuthorize("hasAuthority('hr.attendance.manage')")
    public ApiResponse<List<TypeResponse>> ensureDefaults() {
        leaveService.ensureDefaultTypes();
        return ApiResponse.ok(leaveService.listTypes());
    }

    @PostMapping("/accrue")
    @PreAuthorize("hasAuthority('hr.attendance.manage')")
    public ApiResponse<Void> accrue(@RequestParam int year) {
        leaveService.accrue(year);
        return ApiResponse.ok(null);
    }
}
