package io.restaurantos.hr.controller;

import io.restaurantos.hr.service.ShiftService;
import io.restaurantos.hr.service.ShiftService.AssignRequest;
import io.restaurantos.hr.service.ShiftService.AssignmentResponse;
import io.restaurantos.hr.service.ShiftService.CreateShiftRequest;
import io.restaurantos.hr.service.ShiftService.ShiftResponse;
import io.restaurantos.hr.service.ShiftService.WeekGrid;
import io.restaurantos.shared.api.ApiResponse;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.time.LocalDate;
import java.util.UUID;

/** Shift scheduling API. Manage gated hr.attendance.manage; reads gated hr.attendance.view. */
@RestController
@RequestMapping("/api/v1/hr/shifts")
public class ShiftController {

    private final ShiftService shiftService;

    public ShiftController(ShiftService shiftService) {
        this.shiftService = shiftService;
    }

    public record MoveRequest(UUID assignmentId, UUID newShiftId, LocalDate newWorkDate) {
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    @PreAuthorize("hasAuthority('hr.attendance.manage')")
    public ApiResponse<ShiftResponse> create(@RequestBody CreateShiftRequest req) {
        return ApiResponse.ok(shiftService.create(req));
    }

    @PutMapping("/{id}")
    @PreAuthorize("hasAuthority('hr.attendance.manage')")
    public ApiResponse<ShiftResponse> update(@PathVariable UUID id, @RequestBody CreateShiftRequest req) {
        return ApiResponse.ok(shiftService.update(id, req));
    }

    @DeleteMapping("/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @PreAuthorize("hasAuthority('hr.attendance.manage')")
    public void delete(@PathVariable UUID id) {
        shiftService.delete(id);
    }

    @PostMapping("/assignments")
    @ResponseStatus(HttpStatus.CREATED)
    @PreAuthorize("hasAuthority('hr.attendance.manage')")
    public ApiResponse<AssignmentResponse> assign(@RequestBody AssignRequest req) {
        return ApiResponse.ok(shiftService.assign(req));
    }

    @PostMapping("/assignments/move")
    @PreAuthorize("hasAuthority('hr.attendance.manage')")
    public ApiResponse<AssignmentResponse> move(@RequestBody MoveRequest req) {
        return ApiResponse.ok(shiftService.move(req.assignmentId(), req.newShiftId(), req.newWorkDate()));
    }

    @DeleteMapping("/assignments/{assignmentId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @PreAuthorize("hasAuthority('hr.attendance.manage')")
    public void unassign(@PathVariable UUID assignmentId) {
        shiftService.unassign(assignmentId);
    }

    @GetMapping("/week")
    @PreAuthorize("hasAuthority('hr.attendance.view')")
    public ApiResponse<WeekGrid> week(
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate weekStart) {
        return ApiResponse.ok(shiftService.weekGrid(weekStart));
    }
}
