package io.restaurantos.hr;

import io.restaurantos.hr.adms.AdmsController;
import io.restaurantos.hr.adms.DeviceAuthException;
import io.restaurantos.hr.controller.internal.AttendanceIngestController;
import io.restaurantos.hr.controller.internal.AttendanceIngestController.IngestRequest;
import io.restaurantos.hr.dto.DeviceDtos.DeviceRegistrationResponse;
import io.restaurantos.hr.dto.DeviceDtos.RegisterDeviceRequest;
import io.restaurantos.hr.dto.EmployeeDtos.CreateEmployeeRequest;
import io.restaurantos.hr.dto.EmployeeDtos.EmployeeResponse;
import io.restaurantos.hr.entity.AttendanceDeviceEntity.ConnectionMode;
import io.restaurantos.hr.entity.AttendanceQuarantineEntity;
import io.restaurantos.hr.entity.AttendanceQuarantineEntity.Status;
import io.restaurantos.hr.entity.EmployeeEntity.EmploymentType;
import io.restaurantos.hr.repository.AttendanceQuarantineRepository;
import io.restaurantos.hr.service.AttendanceDeviceService;
import io.restaurantos.hr.service.EmployeeService;
import io.restaurantos.hr.service.PunchIngestService;
import io.restaurantos.shared.event.OutboxEntry;
import io.restaurantos.shared.tenant.TenantContext;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.annotation.Autowired;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.atLeastOnce;
import static org.mockito.Mockito.verify;

/** Both ingest modes: defensive ADMS parse, idempotency, quarantine→resolve→auto-resolve, device auth. */
class AdmsIngestIT extends HrTestBase {

    @Autowired AdmsController admsController;
    @Autowired AttendanceIngestController ingestController;
    @Autowired AttendanceDeviceService deviceService;
    @Autowired EmployeeService employeeService;
    @Autowired PunchIngestService punchIngestService;
    @Autowired AttendanceQuarantineRepository quarantineRepository;
    @Autowired TenantContext tenantContext;

    private record Fixture(UUID tenant, UUID branch, String serial, String token, UUID employeeId) {
    }

    private Fixture register(String pin) {
        UUID tenant = UUID.randomUUID();
        UUID branch = UUID.randomUUID();
        String serial = "SN-adms-" + UUID.randomUUID();
        tenantContext.set(tenant, branch, UUID.randomUUID(), null);
        try {
            DeviceRegistrationResponse reg =
                    deviceService.register(new RegisterDeviceRequest(serial, "ZKTeco", ConnectionMode.NETWORK_ADMS));
            UUID empId = null;
            if (pin != null) {
                EmployeeResponse emp = employeeService.create(new CreateEmployeeRequest(
                        "EMP-" + pin, "Emp " + pin, null, null, null, null, null,
                        EmploymentType.PERMANENT, LocalDate.of(2025, 1, 1), 0L, pin));
                empId = emp.id();
            }
            return new Fixture(tenant, branch, serial, reg.deviceToken(), empId);
        } finally {
            tenantContext.clear();
        }
    }

    @Test
    void admsAttlog_parsesIngestsIdempotently_skipsShortLine() throws Exception {
        Fixture fx = register("1001");
        String good = "1001\t2026-06-15 09:30:00\t0\t1\tREC-9\textra\tmore\tfields\tnine"; // 9 fields
        String shortLine = "bad\tline\t3"; // 3 fields — skipped
        String body = good + "\n" + shortLine;

        assertThat(admsController.cdataUpload(fx.serial(), fx.token(), "ATTLOG", attlogRequest(body))).isEqualTo("OK");
        assertThat(countPunches(fx.employeeId())).isEqualTo(1); // short line skipped

        // Replay the same body — ON CONFLICT means no duplicate row.
        assertThat(admsController.cdataUpload(fx.serial(), fx.token(), "ATTLOG", attlogRequest(body))).isEqualTo("OK");
        assertThat(countPunches(fx.employeeId())).isEqualTo(1);

        ArgumentCaptor<OutboxEntry> captor = ArgumentCaptor.forClass(OutboxEntry.class);
        verify(outboxRepository, atLeastOnce()).save(captor.capture());
        long punched = captor.getAllValues().stream()
                .filter(e -> "ATTENDANCE_PUNCHED".equals(e.getEventType())).count();
        assertThat(punched).isEqualTo(1); // only the genuine insert emitted an event
    }

    @Test
    void unmappedRef_quarantines_thenResolveEstablishesDurableMapping() throws Exception {
        Fixture fx = register(null); // device only, no mapped employee
        UUID empId;
        tenantContext.set(fx.tenant(), fx.branch(), UUID.randomUUID(), null);
        try {
            empId = employeeService.create(new CreateEmployeeRequest(
                    "EMP-2002", "Unmapped", null, null, null, null, null,
                    EmploymentType.PERMANENT, LocalDate.of(2025, 1, 1), 0L, null)).id();
        } finally {
            tenantContext.clear();
        }

        // Punch for an unmapped ref -> quarantine, no attendance_punch.
        admsController.cdataUpload(fx.serial(), fx.token(), "ATTLOG", attlogRequest("2002\t2026-06-15 09:00:00\t0\t1"));
        assertThat(countPunchesByRef("2002")).isZero();

        AttendanceQuarantineEntity q;
        tenantContext.set(fx.tenant(), fx.branch(), UUID.randomUUID(), null);
        try {
            List<AttendanceQuarantineEntity> pending =
                    quarantineRepository.findAllByTenantIdAndStatus(fx.tenant(), Status.PENDING);
            assertThat(pending).hasSize(1);
            q = pending.get(0);
            punchIngestService.resolveQuarantine(q.getId(), empId);
            // durable mapping now set on the employee
            assertThat(quarantineRepository.findById(q.getId()).orElseThrow().getStatus()).isEqualTo(Status.RESOLVED);
        } finally {
            tenantContext.clear();
        }
        assertThat(countPunchesByRef("2002")).isEqualTo(1); // parked punch re-ingested

        // A SUBSEQUENT punch with the same ref auto-resolves — NOT a second quarantine.
        admsController.cdataUpload(fx.serial(), fx.token(), "ATTLOG", attlogRequest("2002\t2026-06-16 09:00:00\t0\t1"));
        assertThat(countPunchesByRef("2002")).isEqualTo(2);
        tenantContext.set(fx.tenant(), fx.branch(), UUID.randomUUID(), null);
        try {
            assertThat(quarantineRepository.findAllByTenantIdAndStatus(fx.tenant(), Status.PENDING)).isEmpty();
        } finally {
            tenantContext.clear();
        }
    }

    @Test
    void wrongToken_rejected_noRows() throws Exception {
        Fixture fx = register("3003");
        assertThatThrownBy(() -> admsController.cdataUpload(
                fx.serial(), "not-the-token", "ATTLOG", attlogRequest("3003\t2026-06-15 09:00:00\t0\t1")))
                .isInstanceOf(DeviceAuthException.class);
        assertThat(countPunches(fx.employeeId())).isZero();
    }

    @Test
    void modeB_jsonIngest_persistsAndEmits() throws Exception {
        Fixture fx = register("4004");
        ingestController.ingest(new IngestRequest(
                fx.serial(), fx.token(), "4004", "IN", Instant.parse("2026-06-15T09:00:00Z")));
        assertThat(countPunches(fx.employeeId())).isEqualTo(1);
    }

    /**
     * 25-05 changed {@code cdataUpload} to read its body from the request input stream rather than
     * from a body binding, because a body binding sees an empty stream whenever the container has
     * already drained the body into the parameter map — which it does for a form-encoded upload, and
     * which silently discarded the whole batch while answering OK.
     *
     * <p>These direct-method-call tests therefore pass a request carrying the body. Note what that
     * makes visible: this class cannot see the defect 25-05 fixed at all, because the container is
     * not in the picture. {@code AdmsBodyContractIT} asserts it over real HTTP; that is the point of
     * that class existing.
     */
    private static jakarta.servlet.http.HttpServletRequest attlogRequest(String body) {
        org.springframework.mock.web.MockHttpServletRequest request =
                new org.springframework.mock.web.MockHttpServletRequest();
        request.setContentType("text/plain;charset=UTF-8");
        request.setContent(body == null ? new byte[0] : body.getBytes(java.nio.charset.StandardCharsets.UTF_8));
        return request;
    }

    private int countPunches(UUID employeeId) throws Exception {
        try (Connection c = DriverManager.getConnection(postgres.getJdbcUrl(), postgres.getUsername(), postgres.getPassword());
             PreparedStatement ps = c.prepareStatement("SELECT count(*) FROM attendance_punches WHERE employee_id = ?")) {
            ps.setObject(1, employeeId);
            try (ResultSet rs = ps.executeQuery()) {
                rs.next();
                return rs.getInt(1);
            }
        }
    }

    private int countPunchesByRef(String ref) throws Exception {
        try (Connection c = DriverManager.getConnection(postgres.getJdbcUrl(), postgres.getUsername(), postgres.getPassword());
             PreparedStatement ps = c.prepareStatement("SELECT count(*) FROM attendance_punches WHERE device_user_ref = ?")) {
            ps.setString(1, ref);
            try (ResultSet rs = ps.executeQuery()) {
                rs.next();
                return rs.getInt(1);
            }
        }
    }
}
