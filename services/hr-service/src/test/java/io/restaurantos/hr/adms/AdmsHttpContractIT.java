package io.restaurantos.hr.adms;

import io.restaurantos.hr.HrTestBase;
import io.restaurantos.hr.dto.DeviceDtos.DeviceRegistrationResponse;
import io.restaurantos.hr.dto.DeviceDtos.RegisterDeviceRequest;
import io.restaurantos.hr.dto.EmployeeDtos.CreateEmployeeRequest;
import io.restaurantos.hr.dto.EmployeeDtos.EmployeeResponse;
import io.restaurantos.hr.entity.AttendanceDeviceEntity.ConnectionMode;
import io.restaurantos.hr.entity.EmployeeEntity.EmploymentType;
import io.restaurantos.hr.service.AttendanceDeviceService;
import io.restaurantos.hr.service.EmployeeService;
import io.restaurantos.shared.event.OutboxEntry;
import io.restaurantos.shared.tenant.TenantContext;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.atLeast;
import static org.mockito.Mockito.verify;

/**
 * THE FROZEN BASELINE — what the ADMS/iClock integration genuinely does today, asserted at the layer
 * a physical terminal talks to.
 *
 * <h2>Why this class exists when {@code AdmsIngestIT} already covers the same ground</h2>
 *
 * <p>Every assertion in {@code AdmsIngestIT} calls {@code admsController.cdataUpload(...)} as a plain
 * Java method. That reaches the business logic and nothing else: query-parameter binding, the
 * {@code Content-Type} the device chose, the servlet body stream, the exception-resolution chain and
 * the HTTP status a device actually receives are all outside its reach. Four separate defects in this
 * adapter survived a fully green suite for exactly that reason. This class goes over real HTTP to a
 * real embedded Tomcat on a random port, so all of those are inside the assertion.
 *
 * <h2>Contract with the rest of phase 25</h2>
 *
 * <p><b>No later plan in this phase may edit this class.</b> It records what already worked before the
 * phase started. A later plan proves its own new behaviour in its own class, so that a regression in
 * the baseline is always distinguishable from a deliberate change in scope. If a change to
 * {@code src/main} makes something here fail, that is a regression, full stop.
 *
 * <h2>Two traps, both hit and both solved — do not undo either</h2>
 *
 * <p><b>Pin the client to HTTP/1.1.</b> {@code HttpClient.newHttpClient()} defaults to
 * {@code Version.HTTP_2} and attempts an h2c upgrade this Tomcat refuses; every request then fails
 * with {@code HTTP/1.1 header parser received no bytes}, which reads exactly like a dead server and
 * costs an hour to diagnose. A real ZKTeco terminal speaks HTTP/1.1 anyway, so the pin is also the
 * faithful choice.
 *
 * <p><b>Send real tab bytes.</b> An ATTLOG body assembled from the two characters backslash-t rather
 * than from {@code \t} collapses into a single unparseable line, every assertion about "no row was
 * written" passes, and it passes for the wrong reason.
 */
@SpringBootTest(
        webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
        // Bind the embedded Tomcat to loopback, and address it as 127.0.0.1 below rather than as the
        // name "localhost". A wildcard-bound random port is picked up by anything on the machine that
        // auto-forwards new listeners, and a forwarder with nothing behind it accepts the connection
        // and closes it — which surfaces as "HTTP/1.1 header parser received no bytes", i.e. exactly
        // the symptom an HTTP/2 upgrade attempt produces, on a client already pinned to HTTP/1.1.
        // See HrTestBase.publishedOnClaimedLoopbackPorts for the same problem on the container side.
        properties = "server.address=127.0.0.1")
class AdmsHttpContractIT extends HrTestBase {

    @LocalServerPort int port;

    @Autowired AttendanceDeviceService deviceService;
    @Autowired EmployeeService employeeService;
    @Autowired TenantContext tenantContext;

    /** HTTP/1.1, deliberately. See the class javadoc — the default version breaks every request. */
    private final HttpClient http = HttpClient.newBuilder()
            .version(HttpClient.Version.HTTP_1_1)
            .connectTimeout(Duration.ofSeconds(10))
            .build();

    private record Fixture(UUID tenant, UUID branch, String serial, String token, UUID employeeId) {
    }

    /** Registers a device and, when {@code pin} is non-null, an employee whose device-user ref is that pin. */
    private Fixture register(String pin) {
        UUID tenant = UUID.randomUUID();
        UUID branch = UUID.randomUUID();
        String serial = "SN-http-" + UUID.randomUUID();
        tenantContext.set(tenant, branch, UUID.randomUUID(), null);
        try {
            DeviceRegistrationResponse reg = deviceService.register(
                    new RegisterDeviceRequest(serial, "ZKTeco", ConnectionMode.NETWORK_ADMS));
            UUID empId = null;
            if (pin != null) {
                EmployeeResponse emp = employeeService.create(new CreateEmployeeRequest(
                        "EMP-" + pin + "-" + UUID.randomUUID(), "Emp " + pin, null, null, null, null, null,
                        EmploymentType.PERMANENT, LocalDate.of(2025, 1, 1), 0L, pin));
                empId = emp.id();
            }
            return new Fixture(tenant, branch, serial, reg.deviceToken(), empId);
        } finally {
            tenantContext.clear();
        }
    }

    private String base() {
        return "http://127.0.0.1:" + port;
    }

    private HttpResponse<String> handshake(String serial, String token) throws Exception {
        String uri = base() + "/iclock/cdata?SN=" + enc(serial) + "&options=all&pushver=2.4.0"
                + (token == null ? "" : "&token=" + enc(token));
        return http.send(HttpRequest.newBuilder(URI.create(uri)).GET().build(),
                HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
    }

    private HttpResponse<String> attlog(String serial, String token, String body) throws Exception {
        String uri = base() + "/iclock/cdata?SN=" + enc(serial) + "&table=ATTLOG&Stamp=9999"
                + (token == null ? "" : "&token=" + enc(token));
        return http.send(HttpRequest.newBuilder(URI.create(uri))
                        .header("Content-Type", "text/plain;charset=UTF-8")
                        .POST(HttpRequest.BodyPublishers.ofString(body, StandardCharsets.UTF_8))
                        .build(),
                HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
    }

    private static String enc(String raw) {
        return java.net.URLEncoder.encode(raw, StandardCharsets.UTF_8);
    }

    // ---------------------------------------------------------------- handshake

    @Test
    void handshakeWithAValidSerialAndTokenReturnsTheDevicesOperatingConfig() throws Exception {
        Fixture fx = register(null);

        HttpResponse<String> res = handshake(fx.serial(), fx.token());

        assertThat(res.statusCode()).isEqualTo(200);
        assertThat(res.body().lines().findFirst().orElseThrow())
                .as("the first line of an iClock handshake names the serial back to the device")
                .contains(fx.serial());
        assertThat(res.body())
                .as("realtime push is the directive that makes a terminal deliver punches as they happen")
                .contains("Realtime=1");
    }

    // ---------------------------------------------------------------- upload

    @Test
    void aPlainTextAttlogUploadWritesOnePunchAndAcknowledgesWithOk() throws Exception {
        Fixture fx = register("1001");

        HttpResponse<String> res = attlog(fx.serial(), fx.token(),
                "1001\t2026-06-15 09:30:00\t0\t1\tREC-9\t0\t0\t0\t0\n");

        assertThat(res.statusCode()).isEqualTo(200);
        assertThat(res.body().trim()).isEqualTo("OK");
        assertThat(countPunches(fx.employeeId())).isEqualTo(1);
    }

    @Test
    void replayingTheIdenticalBatchOverTheWireWritesNoSecondRowAndEmitsNoSecondEvent() throws Exception {
        Fixture fx = register("1002");
        String body = "1002\t2026-06-15 09:30:00\t0\t1\tREC-9\t0\t0\t0\t0\n";

        assertThat(attlog(fx.serial(), fx.token(), body).statusCode()).isEqualTo(200);
        assertThat(countPunches(fx.employeeId())).isEqualTo(1);

        assertThat(attlog(fx.serial(), fx.token(), body).statusCode()).isEqualTo(200);
        assertThat(countPunches(fx.employeeId()))
                .as("D-25-05: a device retransmitting its offline buffer must not double-count")
                .isEqualTo(1);

        ArgumentCaptor<OutboxEntry> captor = ArgumentCaptor.forClass(OutboxEntry.class);
        verify(outboxRepository, atLeast(1)).save(captor.capture());
        long punched = captor.getAllValues().stream()
                .filter(e -> "ATTENDANCE_PUNCHED".equals(e.getEventType()))
                .filter(e -> e.getEnvelopeJson() != null && e.getEnvelopeJson().contains(fx.employeeId().toString()))
                .count();
        assertThat(punched)
                .as("only the genuine insert publishes; the replay publishes nothing")
                .isEqualTo(1);
    }

    @Test
    void aBatchCarryingTheSamePunchTwiceInOneBodyWritesOneRow() throws Exception {
        Fixture fx = register("1003");
        String line = "1003\t2026-06-15 09:30:00\t0\t1\tREC-9\t0\t0\t0\t0";

        assertThat(attlog(fx.serial(), fx.token(), line + "\n" + line + "\n").statusCode()).isEqualTo(200);

        assertThat(countPunches(fx.employeeId())).isEqualTo(1);
    }

    @Test
    void anUnmappedDeviceUserIsQuarantinedWithItsRawLineRetainedVerbatimAndWritesNoPunch() throws Exception {
        Fixture fx = register(null);
        String ref = "UNMAPPED-" + UUID.randomUUID().toString().substring(0, 8);
        String line = ref + "\t2026-06-15 09:30:00\t0\t1";

        assertThat(attlog(fx.serial(), fx.token(), line + "\n").statusCode()).isEqualTo(200);

        assertThat(countPunchesByRef(ref))
                .as("D-25-03: a punch from an unknown device user is never dropped, and never guessed at")
                .isZero();
        assertThat(quarantinedRawLine(ref))
                .as("the raw line is retained exactly as the device sent it, so an admin can read it")
                .isEqualTo(line);
    }

    @Test
    void aWrongTokenWritesNoRowsAtAll() throws Exception {
        Fixture fx = register("1004");

        attlog(fx.serial(), "not-the-token", "1004\t2026-06-15 09:30:00\t0\t1\n");

        assertThat(countPunches(fx.employeeId())).isZero();
        assertThat(countQuarantine(fx.serial())).isZero();
    }

    @Test
    void theDeviceReportedInstantAndTheServerReceivedInstantAreStoredSeparatelyAndDiffer() throws Exception {
        Fixture fx = register("1005");
        // Asia/Karachi is UTC+5 with no DST, so 09:30 local is 04:30Z. The device reports local time;
        // the server records arrival. They are two different facts and the schema keeps both.
        Instant reported = Instant.parse("2026-06-15T04:30:00Z");

        assertThat(attlog(fx.serial(), fx.token(), "1005\t2026-06-15 09:30:00\t0\t1\n").statusCode()).isEqualTo(200);

        try (Connection c = jdbc();
             PreparedStatement ps = c.prepareStatement(
                     "SELECT device_reported_at, server_received_at FROM attendance_punches WHERE employee_id = ?")) {
            ps.setObject(1, fx.employeeId());
            try (ResultSet rs = ps.executeQuery()) {
                assertThat(rs.next()).isTrue();
                Instant storedReported = rs.getTimestamp(1).toInstant();
                Instant storedReceived = rs.getTimestamp(2).toInstant();
                assertThat(storedReported)
                        .as("what the device said, kept exactly as it said it")
                        .isEqualTo(reported);
                assertThat(storedReceived)
                        .as("when the server got it — a separate fact; a future change that sets one "
                                + "from the other must fail here")
                        .isAfter(storedReported)
                        .isNotEqualTo(storedReported);
            }
        }
    }

    // ---------------------------------------------------------------- command channel

    @Test
    void anAuthenticatedDeviceCanPollForCommandsAndAcknowledgeOne() throws Exception {
        Fixture fx = register(null);

        HttpResponse<String> poll = http.send(HttpRequest.newBuilder(URI.create(
                                base() + "/iclock/getrequest?SN=" + enc(fx.serial()) + "&token=" + enc(fx.token())))
                        .GET().build(),
                HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
        assertThat(poll.statusCode()).isEqualTo(200);

        HttpResponse<String> ack = http.send(HttpRequest.newBuilder(URI.create(
                                base() + "/iclock/devicecmd?SN=" + enc(fx.serial()) + "&token=" + enc(fx.token())))
                        .header("Content-Type", "text/plain;charset=UTF-8")
                        .POST(HttpRequest.BodyPublishers.ofString("ID=1&Return=0&CMD=DATA", StandardCharsets.UTF_8))
                        .build(),
                HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
        assertThat(ack.statusCode()).isEqualTo(200);
    }

    // ---------------------------------------------------------------- JDBC helpers

    private Connection jdbc() throws Exception {
        return DriverManager.getConnection(postgres.getJdbcUrl(), postgres.getUsername(), postgres.getPassword());
    }

    private int countPunches(UUID employeeId) throws Exception {
        try (Connection c = jdbc();
             PreparedStatement ps = c.prepareStatement(
                     "SELECT count(*) FROM attendance_punches WHERE employee_id = ?")) {
            ps.setObject(1, employeeId);
            try (ResultSet rs = ps.executeQuery()) {
                rs.next();
                return rs.getInt(1);
            }
        }
    }

    private int countPunchesByRef(String ref) throws Exception {
        try (Connection c = jdbc();
             PreparedStatement ps = c.prepareStatement(
                     "SELECT count(*) FROM attendance_punches WHERE device_user_ref = ?")) {
            ps.setString(1, ref);
            try (ResultSet rs = ps.executeQuery()) {
                rs.next();
                return rs.getInt(1);
            }
        }
    }

    private int countQuarantine(String serial) throws Exception {
        try (Connection c = jdbc();
             PreparedStatement ps = c.prepareStatement(
                     "SELECT count(*) FROM attendance_quarantine q JOIN attendance_devices d ON d.id = q.device_id "
                             + "WHERE d.serial_no = ?")) {
            ps.setString(1, serial);
            try (ResultSet rs = ps.executeQuery()) {
                rs.next();
                return rs.getInt(1);
            }
        }
    }

    private String quarantinedRawLine(String ref) throws Exception {
        try (Connection c = jdbc();
             PreparedStatement ps = c.prepareStatement(
                     "SELECT raw_line FROM attendance_quarantine WHERE device_user_ref = ?")) {
            ps.setString(1, ref);
            try (ResultSet rs = ps.executeQuery()) {
                return rs.next() ? rs.getString(1) : null;
            }
        }
    }
}
