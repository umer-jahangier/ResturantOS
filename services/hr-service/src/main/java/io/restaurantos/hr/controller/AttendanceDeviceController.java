package io.restaurantos.hr.controller;

import io.restaurantos.hr.dto.DeviceDtos.DeviceRegistrationResponse;
import io.restaurantos.hr.dto.DeviceDtos.DeviceResponse;
import io.restaurantos.hr.dto.DeviceDtos.RegisterDeviceRequest;
import io.restaurantos.hr.service.AttendanceDeviceService;
import io.restaurantos.shared.api.ApiResponse;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.UUID;

/**
 * Biometric device registry management. Registration/deactivation require {@code hr.attendance.manage};
 * listing requires {@code hr.attendance.view}. This is the human-facing admin API — the device push
 * traffic itself arrives on the separate JWT-exempt /iclock path guarded by DeviceAuthResolver.
 */
@RestController
@RequestMapping("/api/v1/hr/devices")
public class AttendanceDeviceController {

    private final AttendanceDeviceService deviceService;

    public AttendanceDeviceController(AttendanceDeviceService deviceService) {
        this.deviceService = deviceService;
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    @PreAuthorize("hasAuthority('hr.attendance.manage')")
    public ApiResponse<DeviceRegistrationResponse> register(@Valid @RequestBody RegisterDeviceRequest req) {
        return ApiResponse.ok(deviceService.register(req));
    }

    @GetMapping
    @PreAuthorize("hasAuthority('hr.attendance.view')")
    public ApiResponse<List<DeviceResponse>> list() {
        return ApiResponse.ok(deviceService.list());
    }

    @DeleteMapping("/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @PreAuthorize("hasAuthority('hr.attendance.manage')")
    public void deactivate(@PathVariable UUID id) {
        deviceService.deactivate(id);
    }
}
