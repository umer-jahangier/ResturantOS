package io.restaurantos.hr.controller.internal;

import io.restaurantos.hr.adms.DeviceAuthResolver;
import io.restaurantos.hr.entity.AttendanceDeviceEntity;
import io.restaurantos.hr.entity.AttendancePunchEntity.PunchType;
import io.restaurantos.hr.service.PunchIngestService;
import io.restaurantos.hr.service.PunchIngestService.IngestResult;
import io.restaurantos.shared.tenant.TenantContext;
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

    public record IngestRequest(String serial, String token, String employeeRef, String punchType, Instant punchedAt) {
    }

    @PostMapping("/ingest")
    public Map<String, String> ingest(@RequestBody IngestRequest req) {
        AttendanceDeviceEntity device = deviceAuthResolver.resolve(req.serial(), req.token());
        try {
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
