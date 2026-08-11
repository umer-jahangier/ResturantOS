package io.restaurantos.hr.controller.internal;

import io.restaurantos.hr.adms.DeviceAuthResolver;
import io.restaurantos.hr.entity.AttendanceDeviceEntity;
import io.restaurantos.hr.entity.AttendancePunchEntity.PunchType;
import io.restaurantos.hr.service.PunchIngestService;
import io.restaurantos.hr.service.PunchIngestService.IngestResult;
import io.restaurantos.shared.tenant.TenantContext;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.time.Instant;
import java.util.Map;

/**
 * Mode B ingest: the out-of-JVM USB bridge agent POSTs already-matched punches here. Authenticated
 * by the SAME device token as /iclock (NOT X-Internal-Service — StripInternalHeaderFilter would strip
 * that). Matching happens in the agent; only {employeeRef, deviceId, punchedAt} is sent (no biometrics).
 */
@RestController
@RequestMapping("/internal/attendance")
public class AttendanceIngestController {

    private final DeviceAuthResolver deviceAuthResolver;
    private final PunchIngestService punchIngestService;
    private final TenantContext tenantContext;

    public AttendanceIngestController(DeviceAuthResolver deviceAuthResolver,
                                     PunchIngestService punchIngestService, TenantContext tenantContext) {
        this.deviceAuthResolver = deviceAuthResolver;
        this.punchIngestService = punchIngestService;
        this.tenantContext = tenantContext;
    }

    /**
     * Constrained even though the caller is a field device rather than a person.
     *
     * <p>An unvalidated body from a device is a WIDER hole than one from a signed-in user, not a
     * narrower one: this path is device-token authenticated, reachable without a JWT, and polled
     * every few seconds forever. {@code punchType} is deliberately unconstrained — the handler
     * already maps an unknown or absent value to {@code UNKNOWN}, which is the correct behaviour
     * for a device firmware that reports a code we have not seen.
     */
    public record IngestRequest(
            @NotBlank String serial,
            @NotBlank String token,
            @NotBlank String employeeRef,
            String punchType,
            @NotNull Instant punchedAt) {
    }

    @PostMapping("/ingest")
    public Map<String, String> ingest(@Valid @RequestBody IngestRequest req) {
        // resolve() binds TenantContext before it persists the device's last-seen timestamp, so it
        // must be INSIDE the try — otherwise a failure in that save leaves the tenant bound to this
        // pooled request thread and the next request inherits it.
        try {
            AttendanceDeviceEntity device = deviceAuthResolver.resolve(req.serial(), req.token());
            PunchType type;
            try {
                type = req.punchType() == null ? PunchType.UNKNOWN : PunchType.valueOf(req.punchType());
            } catch (IllegalArgumentException e) {
                type = PunchType.UNKNOWN;
            }
            IngestResult result = punchIngestService.ingest(
                    device, req.employeeRef(), req.punchedAt(), type, null, null);
            return Map.of("result", result.name());
        } finally {
            tenantContext.clear();
        }
    }
}
