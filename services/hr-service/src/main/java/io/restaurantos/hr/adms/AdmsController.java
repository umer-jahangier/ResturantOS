package io.restaurantos.hr.adms;

import io.restaurantos.hr.entity.AttendanceDeviceEntity;
import io.restaurantos.hr.service.PunchIngestService;
import io.restaurantos.shared.tenant.TenantContext;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * ADMS/iClock adapter (Mode A) — plain-text, tab-delimited, serial-addressed. Every handler resolves
 * the device (serial + token) via {@link io.restaurantos.hr.adms.DeviceAuthResolver} FIRST (no user
 * JWT / X-Tenant-Id exists on this path) and CLEARS the tenant context in a finally (pooled threads).
 * Punch parsing is defensive; the server replies with a bare "OK".
 */
@RestController
public class AdmsController {

    private final DeviceAuthResolver deviceAuthResolver;
    private final AttlogLineParser parser;
    private final PunchIngestService punchIngestService;
    private final DeviceCommandQueueService commandQueue;
    private final TenantContext tenantContext;

    public AdmsController(DeviceAuthResolver deviceAuthResolver, AttlogLineParser parser,
                         PunchIngestService punchIngestService, DeviceCommandQueueService commandQueue,
                         TenantContext tenantContext) {
        this.deviceAuthResolver = deviceAuthResolver;
        this.parser = parser;
        this.punchIngestService = punchIngestService;
        this.commandQueue = commandQueue;
        this.tenantContext = tenantContext;
    }

    /** Handshake: the device fetches its operating config. */
    @GetMapping(value = "/iclock/cdata", produces = MediaType.TEXT_PLAIN_VALUE)
    public String cdataHandshake(@RequestParam("SN") String sn,
                                 @RequestParam(value = "token", required = false) String token) {
        try {
            deviceAuthResolver.resolve(sn, token);
            return "GET OPTION FROM: " + sn + "\n"
                    + "Stamp=0\n"
                    + "OpStamp=0\n"
                    + "ErrorDelay=30\n"
                    + "Delay=30\n"
                    + "TransTimes=00:00;14:05\n"
                    + "TransInterval=1\n"
                    + "TransFlag=1111000000\n"
                    + "Realtime=1\n"
                    + "Encrypt=0\n";
        } finally {
            tenantContext.clear();
        }
    }

    /** Attendance upload: the device pushes ATTLOG records; we parse each line and ingest. */
    @PostMapping(value = "/iclock/cdata", produces = MediaType.TEXT_PLAIN_VALUE)
    public String cdataUpload(@RequestParam("SN") String sn,
                              @RequestParam(value = "token", required = false) String token,
                              @RequestParam(value = "table", required = false) String table,
                              @RequestBody(required = false) String body) {
        // Inside the try, matching the other three handlers: resolve() binds TenantContext before it
        // saves the device's last-seen timestamp, so a failure in that save would otherwise leak the
        // tenant onto this pooled request thread for the next caller to inherit.
        try {
            AttendanceDeviceEntity device = deviceAuthResolver.resolve(sn, token);
            if ("ATTLOG".equalsIgnoreCase(table) && body != null) {
                for (String line : body.split("\\r?\\n")) {
                    parser.parse(line).ifPresent(p -> punchIngestService.ingest(
                            device, p.deviceUserRef(), p.deviceReportedAt(), p.punchType(), p.sourceRecordId(), line));
                }
            }
            return "OK";
        } finally {
            tenantContext.clear();
        }
    }

    /** Command poll: the device asks for queued server commands (usually none). */
    @GetMapping(value = "/iclock/getrequest", produces = MediaType.TEXT_PLAIN_VALUE)
    public String getRequest(@RequestParam("SN") String sn,
                             @RequestParam(value = "token", required = false) String token) {
        try {
            deviceAuthResolver.resolve(sn, token);
            return commandQueue.pendingCommandsFor(sn);
        } finally {
            tenantContext.clear();
        }
    }

    /** Command result: the device reports the outcome of a previously-issued command. */
    @PostMapping(value = "/iclock/devicecmd", produces = MediaType.TEXT_PLAIN_VALUE)
    public String deviceCmd(@RequestParam("SN") String sn,
                            @RequestParam(value = "token", required = false) String token,
                            @RequestBody(required = false) String body) {
        try {
            deviceAuthResolver.resolve(sn, token);
            commandQueue.recordAck(sn, body);
            return "OK";
        } finally {
            tenantContext.clear();
        }
    }
}
