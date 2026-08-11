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
import io.restaurantos.shared.tenant.TenantContext;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;

import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.time.Duration;
import java.time.LocalDate;
import java.util.UUID;

/**
 * Shared wire plumbing for the phase-25 ADMS defect registries: a device fixture, an HTTP/1.1 client
 * and the JDBC counters each registry needs.
 *
 * <p>Deliberately NOT shared with {@link AdmsHttpContractIT}. That class is the frozen baseline of
 * what already worked, and a baseline that inherits from something five later plans are free to edit
 * is not frozen — a change made for one defect class would silently move the baseline too. The
 * duplication between the two is the price of that guarantee and it is worth paying.
 *
 * <p>The HTTP client is pinned to HTTP/1.1. The default client attempts an h2c upgrade this Tomcat
 * refuses and every request then dies with {@code HTTP/1.1 header parser received no bytes}, which
 * reads exactly like a dead server. A real terminal speaks HTTP/1.1 anyway.
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
abstract class AdmsWireTestBase extends HrTestBase {

    @LocalServerPort protected int port;

    @Autowired protected AttendanceDeviceService deviceService;
    @Autowired protected EmployeeService employeeService;
    @Autowired protected TenantContext tenantContext;

    protected final HttpClient http = HttpClient.newBuilder()
            .version(HttpClient.Version.HTTP_1_1)
            .connectTimeout(Duration.ofSeconds(10))
            .build();

    protected record Fixture(UUID tenant, UUID branch, String serial, String token, UUID employeeId,
                             String serverUrl) {
    }

    protected Fixture register(String pin) {
        UUID tenant = UUID.randomUUID();
        UUID branch = UUID.randomUUID();
        String serial = "SN-defect-" + UUID.randomUUID();
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
            return new Fixture(tenant, branch, serial, reg.deviceToken(), empId, reg.serverUrl());
        } finally {
            tenantContext.clear();
        }
    }

    protected String base() {
        return "http://127.0.0.1:" + port;
    }

    protected static String enc(String raw) {
        return URLEncoder.encode(raw, StandardCharsets.UTF_8);
    }

    /** The exact boot request a stock ZKTeco terminal sends, with an optional token appended. */
    protected HttpResponse<String> handshake(String serial, String token) throws Exception {
        String uri = base() + "/iclock/cdata?SN=" + enc(serial) + "&options=all&pushver=2.4.0"
                + (token == null ? "" : "&token=" + enc(token));
        return http.send(HttpRequest.newBuilder(URI.create(uri)).GET().build(),
                HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
    }

    protected HttpResponse<String> attlog(String serial, String token, String contentType, String body)
            throws Exception {
        String uri = base() + "/iclock/cdata?SN=" + enc(serial) + "&table=ATTLOG&Stamp=9999"
                + (token == null ? "" : "&token=" + enc(token));
        return http.send(HttpRequest.newBuilder(URI.create(uri))
                        .header("Content-Type", contentType)
                        .POST(HttpRequest.BodyPublishers.ofString(body, StandardCharsets.UTF_8))
                        .build(),
                HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
    }

    protected HttpResponse<String> getRequest(String serial, String token) throws Exception {
        return http.send(HttpRequest.newBuilder(URI.create(
                                base() + "/iclock/getrequest?SN=" + enc(serial) + "&token=" + enc(token)))
                        .GET().build(),
                HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
    }

    // ---------------------------------------------------------------- JDBC counters

    protected Connection jdbc() throws Exception {
        return DriverManager.getConnection(postgres.getJdbcUrl(), postgres.getUsername(), postgres.getPassword());
    }

    protected int countPunchesByRef(String ref) throws Exception {
        return count("SELECT count(*) FROM attendance_punches WHERE device_user_ref = ?", ref);
    }

    protected int countQuarantineByRef(String ref) throws Exception {
        return count("SELECT count(*) FROM attendance_quarantine WHERE device_user_ref = ?", ref);
    }

    protected int countPunchesForDevice(String serial) throws Exception {
        return count("SELECT count(*) FROM attendance_punches p JOIN attendance_devices d ON d.id = p.device_id "
                + "WHERE d.serial_no = ?", serial);
    }

    protected int countQuarantineForDevice(String serial) throws Exception {
        return count("SELECT count(*) FROM attendance_quarantine q JOIN attendance_devices d ON d.id = q.device_id "
                + "WHERE d.serial_no = ?", serial);
    }

    private int count(String sql, String arg) throws Exception {
        try (Connection c = jdbc(); PreparedStatement ps = c.prepareStatement(sql)) {
            ps.setString(1, arg);
            try (ResultSet rs = ps.executeQuery()) {
                rs.next();
                return rs.getInt(1);
            }
        }
    }
}
