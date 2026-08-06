package io.restaurantos.hr.controller;

import io.restaurantos.hr.entity.AttendancePunchEntity;
import io.restaurantos.hr.service.AttendanceService;
import io.restaurantos.hr.service.AttendanceService.DailyAttendanceSummary;
import io.restaurantos.shared.api.ApiResponse;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

/** Manual attendance. Clock endpoints gated hr.attendance.manage; reads gated hr.attendance.view. */
@RestController
@RequestMapping("/api/v1/hr/attendance")
public class AttendanceController {

    private final AttendanceService attendanceService;

    public AttendanceController(AttendanceService attendanceService) {
        this.attendanceService = attendanceService;
    }

    @PostMapping("/{employeeId}/clock-in")
    @PreAuthorize("hasAuthority('hr.attendance.manage')")
    public ApiResponse<AttendancePunchEntity> clockIn(@PathVariable UUID employeeId) {
        return ApiResponse.ok(attendanceService.clockIn(employeeId));
    }

    @PostMapping("/{employeeId}/clock-out")
    @PreAuthorize("hasAuthority('hr.attendance.manage')")
    public ApiResponse<AttendancePunchEntity> clockOut(@PathVariable UUID employeeId) {
        return ApiResponse.ok(attendanceService.clockOut(employeeId));
    }

    @GetMapping("/{employeeId}/punches")
    @PreAuthorize("hasAuthority('hr.attendance.view')")
    public ApiResponse<List<AttendancePunchEntity>> punches(
            @PathVariable UUID employeeId,
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate date) {
        return ApiResponse.ok(attendanceService.punchesForDay(employeeId, date));
    }

    @GetMapping("/{employeeId}/summary")
    @PreAuthorize("hasAuthority('hr.attendance.view')")
    public ApiResponse<DailyAttendanceSummary> summary(
            @PathVariable UUID employeeId,
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate date) {
        return ApiResponse.ok(attendanceService.deriveLateEarly(employeeId, date));
    }
}
