package io.restaurantos.hr.dto;

import io.restaurantos.hr.entity.AttendanceDeviceEntity.ConnectionMode;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

import io.restaurantos.hr.entity.AttendanceDeviceEntity;

import java.time.Instant;
import java.util.List;
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

    /**
     * Registration only — carries the one-time plaintext token and what to type into the terminal.
     *
     * <p>{@code deviceToken} is non-null ONLY for a device in TOKEN mode. A terminal in a mode that
     * presents no secret has no token to be given, and returning one anyway would be worse than
     * useless: an installer would type it into a field that does not exist and conclude the product
     * is broken.
     *
     * <p>{@code setup} is the mode-appropriate instruction set. Before 25-08 this response carried
     * {@code serverUrl}, whose value was the compiled-in placeholder {@code REPLACE-WITH-GATEWAY-HOST}
     * on every deployment.
     */
    public record DeviceRegistrationResponse(
            DeviceResponse device,
            String deviceToken,
            String serverUrl,
            DeviceSetupInstructions setup) {
    }

    /**
     * What a person standing in front of the terminal has to do.
     *
     * <p>A stock ZKTeco's menu is COMM -> Cloud Server -> Enable / Domain Name / Server Address /
     * Server Port. These fields map onto exactly that, which is why they are named for the menu
     * rather than for the protocol.
     */
    public record DeviceSetupInstructions(
            AttendanceDeviceEntity.AuthMode authMode,
            String serverAddress,
            Integer serverPort,
            String domainName,
            List<String> steps,
            String networkAdministratorNote) {
    }
}
