package io.restaurantos.hr.dto;

import io.restaurantos.hr.entity.AttendanceDeviceEntity.ConnectionMode;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

import java.time.Instant;
import java.util.UUID;

/**
 * Device-registry DTOs. The device token is returned in plaintext EXACTLY ONCE, in the
 * registration response; it is never echoed by list/get (only ciphertext lives in the DB).
 */
public final class DeviceDtos {

    private DeviceDtos() {
    }

    public record RegisterDeviceRequest(
            @NotBlank String serialNo,
            String model,
            @NotNull ConnectionMode connectionMode) {
    }

    public record DeviceResponse(
            UUID id,
            String serialNo,
            String model,
            ConnectionMode connectionMode,
            UUID branchId,
            boolean active,
            Instant lastSeenAt) {
    }

    /** Registration only — carries the one-time plaintext token and the URL to enter on the device. */
    public record DeviceRegistrationResponse(
            DeviceResponse device,
            String deviceToken,
            String serverUrl) {
    }
}
