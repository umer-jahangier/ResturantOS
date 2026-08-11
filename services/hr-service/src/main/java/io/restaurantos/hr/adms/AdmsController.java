package io.restaurantos.hr.adms;

import io.restaurantos.hr.entity.AttendanceDeviceEntity;
import io.restaurantos.shared.tenant.TenantContext;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.io.IOException;
import java.nio.charset.StandardCharsets;

/**
 * ADMS/iClock adapter (Mode A) — plain-text, tab-delimited, serial-addressed. Every handler resolves
 * the device (serial + token) via {@link io.restaurantos.hr.adms.DeviceAuthResolver} FIRST (no user
 * JWT / X-Tenant-Id exists on this path) and CLEARS the tenant context in a finally (pooled threads).
 * Punch parsing is defensive; the server replies with a bare "OK".
 */
@RestController
public class AdmsController {

    private final DeviceAuthResolver deviceAuthResolver;
    private final AdmsBatchIngestService batchIngestService;
    private final DeviceCommandQueueService commandQueue;
    private final TenantContext tenantContext;
    private final AdmsRequestContext requestContext;

    public AdmsController(DeviceAuthResolver deviceAuthResolver, AdmsBatchIngestService batchIngestService,
                         DeviceCommandQueueService commandQueue, TenantContext tenantContext,
                         AdmsRequestContext requestContext) {
        this.deviceAuthResolver = deviceAuthResolver;
        this.batchIngestService = batchIngestService;
        this.commandQueue = commandQueue;
        this.tenantContext = tenantContext;
        this.requestContext = requestContext;
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

    /**
     * Attendance upload: the device pushes ATTLOG records.
     *
     * <p><b>The body is read from the input stream, not from a body binding, and decoded as UTF-8
     * explicitly.</b> Two separate defects live in the alternative. A binding sees an empty stream
     * when the container has already drained the body into the parameter map — which it does whenever
     * the device declares form encoding — and the old null guard then skipped ingest entirely,
     * answering {@code OK} over zero rows. {@link io.restaurantos.hr.config.DeviceBodyPreservingFilter}
     * now prevents that consumption; reading the stream here is the other half. And decoding with the
     * platform default charset differs between a developer's machine and a container, so the same
     * bytes would produce different text in each — for a non-ASCII device user reference that is a
     * punch attributed to nobody on one of them.
     *
     * <p>The wire reply is unchanged in every case, including when the batch yields nothing: the
     * protocol says {@code OK} and the device's retry behaviour depends on it. A batch that produced
     * nothing becomes visible in the server log, never in what the device is told — see
     * {@link AdmsBatchIngestService}.
     */
    @PostMapping(value = "/iclock/cdata", produces = MediaType.TEXT_PLAIN_VALUE)
    public String cdataUpload(@RequestParam("SN") String sn,
                              @RequestParam(value = "token", required = false) String token,
                              @RequestParam(value = "table", required = false) String table,
                              HttpServletRequest request) {
        // Inside the try, matching the other three handlers: resolve() binds TenantContext before it
        // saves the device's last-seen timestamp, so a failure in that save would otherwise leak the
        // tenant onto this pooled request thread for the next caller to inherit.
        try {
            AdmsRequestContext.Captured captured =
                    requestContext.capture(sn, token, table, request.getContentType());
            AttendanceDeviceEntity device = deviceAuthResolver.resolve(captured.serialNo(), captured.presentedToken());
            if ("ATTLOG".equalsIgnoreCase(captured.table())) {
                batchIngestService.ingestAttlog(device, readBody(request), captured.declaredContentType());
            }
            return "OK";
        } finally {
            tenantContext.clear();
        }
    }

    /** Explicit UTF-8. Never the platform default — see the handler javadoc. */
    private static String readBody(HttpServletRequest request) {
        try {
            return new String(request.getInputStream().readAllBytes(), StandardCharsets.UTF_8);
        } catch (IOException e) {
            // A truncated upload is not a parse failure and must not look like one.
            return "";
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
