package io.restaurantos.hr.adms;

import io.restaurantos.hr.HrTestBase;
import io.restaurantos.hr.entity.AttendanceDeviceEntity;
import io.restaurantos.hr.entity.AttendanceDeviceEntity.AuthMode;
import io.restaurantos.hr.entity.AttendanceDeviceEntity.ConnectionMode;
import io.restaurantos.hr.entity.AttendanceDeviceEntity.HealthState;
import io.restaurantos.hr.repository.AttendanceDeviceRepository;
import io.restaurantos.shared.tenant.TenantContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * The columns 25-03 adds, the mappings that must agree with them, and the query that will make
 * silence loud (D-25-02) — tested before the sweep that calls it is written.
 *
 * <h2>The most important assertion in this class has no assertion body</h2>
 *
 * <p>{@code HrTestBase} runs with {@code spring.jpa.hibernate.ddl-auto: validate}, deliberately
 * matching the deployed configuration. So <b>a context that starts is the proof that the JPA mappings
 * and the schema Liquibase just built agree</b> — and every test here starts one. Read the comment on
 * that property in {@code HrTestBase} before touching it: the last time it was off, three
 * {@code NUMERIC(6,3)} columns were mapped as {@code double}, hr-service could not start against any
 * real migrated database, and all eighteen integration tests passed anyway. A green suite reported a
 * service that could not boot.
 */
class AttendanceDeviceSchemaIT extends HrTestBase {

    @Autowired AttendanceDeviceRepository repository;
    @Autowired TenantContext tenantContext;

    /**
     * A context that starts IS the schema-versus-mapping assertion — see the class javadoc. There is
     * deliberately nothing to assert in the body: writing one would be pretending the check lives
     * somewhere it does not.
     */
    @Test
    void theContextStartsWithSchemaValidationOnWhichIsTheMappingAssertion() {
        assertThat(repository).isNotNull();
    }

    @Test
    void everyAddedColumnRoundTripsThroughTheEntity() {
        UUID tenant = UUID.randomUUID();
        UUID branch = UUID.randomUUID();
        UUID id = inTenant(tenant, branch, () -> {
            AttendanceDeviceEntity d = newDevice(tenant, branch);
            d.setDisplayName("Kitchen door");
            d.setDeviceTimezone("Asia/Dubai");
            d.setExpectedContactIntervalSeconds(120);
            d.setHealthState(HealthState.SILENT);
            d.setSilentSince(Instant.parse("2026-08-01T00:00:00Z"));
            d.setMaxClockSkewSeconds(60);
            d.setRealtimePush(false);
            d.setPollDelaySeconds(45);
            d.setErrorDelaySeconds(90);
            d.setTransferIntervalMinutes(5);
            d.setTransferTimes("06:00;18:00");
            d.setTransferFlag("0101010101");
            d.setAuthMode(AuthMode.SERIAL_ONLY_BOUNDED);
            d.setSourceAddressAllowlist("203.0.113.7,198.51.100.0/24");
            d.setLastRefusedSourceAddress("203.0.113.9");
            d.setLastRefusedAt(Instant.parse("2026-08-02T00:00:00Z"));
            d.setArchivedAt(Instant.parse("2026-08-03T00:00:00Z"));
            d.setTokenRotatedAt(Instant.parse("2026-08-04T00:00:00Z"));
            return repository.save(d).getId();
        });

        AttendanceDeviceEntity read = inTenant(tenant, branch, () -> repository.findById(id).orElseThrow());

        assertThat(read.getDisplayName()).isEqualTo("Kitchen door");
        assertThat(read.getDeviceTimezone()).isEqualTo("Asia/Dubai");
        assertThat(read.getExpectedContactIntervalSeconds()).isEqualTo(120);
        assertThat(read.getHealthState()).isEqualTo(HealthState.SILENT);
        assertThat(read.getSilentSince()).isEqualTo(Instant.parse("2026-08-01T00:00:00Z"));
        assertThat(read.getMaxClockSkewSeconds()).isEqualTo(60);
        assertThat(read.isRealtimePush()).isFalse();
        assertThat(read.getPollDelaySeconds()).isEqualTo(45);
        assertThat(read.getErrorDelaySeconds()).isEqualTo(90);
        assertThat(read.getTransferIntervalMinutes()).isEqualTo(5);
        assertThat(read.getTransferTimes()).isEqualTo("06:00;18:00");
        assertThat(read.getTransferFlag()).isEqualTo("0101010101");
        assertThat(read.getAuthMode()).isEqualTo(AuthMode.SERIAL_ONLY_BOUNDED);
        assertThat(read.getSourceAddressAllowlist()).isEqualTo("203.0.113.7,198.51.100.0/24");
        assertThat(read.getLastRefusedSourceAddress()).isEqualTo("203.0.113.9");
        assertThat(read.getLastRefusedAt()).isEqualTo(Instant.parse("2026-08-02T00:00:00Z"));
        assertThat(read.getArchivedAt()).isEqualTo(Instant.parse("2026-08-03T00:00:00Z"));
        assertThat(read.getTokenRotatedAt()).isEqualTo(Instant.parse("2026-08-04T00:00:00Z"));
    }

    /**
     * The migration must change nothing about a device that already existed. Every default is the
     * value the code produced before this plan, so a row created without touching any new field
     * behaves exactly as it did — including {@code AuthMode.TOKEN}, which D-25-06 forbids relaxing by
     * migration or by default.
     */
    @Test
    void aDeviceSavedWithoutTouchingAnyNewFieldGetsTodaysBehaviourExactly() {
        UUID tenant = UUID.randomUUID();
        UUID branch = UUID.randomUUID();
        UUID id = inTenant(tenant, branch, () -> repository.save(newDevice(tenant, branch)).getId());

        AttendanceDeviceEntity read = inTenant(tenant, branch, () -> repository.findById(id).orElseThrow());

        assertThat(read.getAuthMode())
                .as("D-25-06: no existing device changes mode by migration, by default, or as a side effect")
                .isEqualTo(AuthMode.TOKEN);
        assertThat(read.getDeviceTimezone()).isEqualTo("Asia/Karachi");
        assertThat(read.getHealthState()).isEqualTo(HealthState.UNKNOWN);
        assertThat(read.isRealtimePush()).isTrue();
        assertThat(read.getPollDelaySeconds()).isEqualTo(30);
        assertThat(read.getErrorDelaySeconds()).isEqualTo(30);
        assertThat(read.getTransferIntervalMinutes()).isEqualTo(1);
        assertThat(read.getTransferTimes())
                .as("byte-identical to the literal AdmsController emits today")
                .isEqualTo("00:00;14:05");
        assertThat(read.getTransferFlag()).isEqualTo("1111000000");
        assertThat(read.getExpectedContactIntervalSeconds()).isEqualTo(900);
        assertThat(read.getMaxClockSkewSeconds()).isEqualTo(300);
        assertThat(read.getArchivedAt()).isNull();
        assertThat(read.getSourceAddressAllowlist()).isNull();
    }

    @Test
    void aDeviceSilentLongerThanItsOwnIntervalIsReturnedAndOneWithinItsIntervalIsNot() {
        UUID tenant = UUID.randomUUID();
        UUID branch = UUID.randomUUID();
        Instant now = Instant.parse("2026-08-11T12:00:00Z");

        inTenant(tenant, branch, () -> {
            repository.save(device(tenant, branch, "overdue", 300, now.minus(1, ChronoUnit.HOURS)));
            repository.save(device(tenant, branch, "fine", 86_400, now.minus(1, ChronoUnit.HOURS)));
            return null;
        });

        List<String> silent = serialsOf(inTenant(tenant, branch, () -> repository.findSilentDevices(tenant, now)));

        assertThat(silent).containsExactly("overdue");
    }

    @Test
    void aDeviceNeverContactedAtAllIsReturnedFirst() {
        UUID tenant = UUID.randomUUID();
        UUID branch = UUID.randomUUID();
        Instant now = Instant.parse("2026-08-11T12:00:00Z");

        inTenant(tenant, branch, () -> {
            repository.save(device(tenant, branch, "silent-a-while", 300, now.minus(1, ChronoUnit.HOURS)));
            repository.save(device(tenant, branch, "never-once", 300, null));
            return null;
        });

        List<String> silent = serialsOf(inTenant(tenant, branch, () -> repository.findSilentDevices(tenant, now)));

        assertThat(silent)
                .as("registered and never worked once is a stronger fault than fell silent")
                .containsExactly("never-once", "silent-a-while");
    }

    @Test
    void aDeviceWithAShorterIntervalOutranksOneWithALongerIntervalAtTheSameAge() {
        UUID tenant = UUID.randomUUID();
        UUID branch = UUID.randomUUID();
        Instant now = Instant.parse("2026-08-11T12:00:00Z");
        Instant lastSeen = now.minus(1, ChronoUnit.HOURS);

        inTenant(tenant, branch, () -> {
            repository.save(device(tenant, branch, "expected-every-30-min", 1_800, lastSeen));
            repository.save(device(tenant, branch, "expected-every-5-min", 300, lastSeen));
            return null;
        });

        List<String> silent = serialsOf(inTenant(tenant, branch, () -> repository.findSilentDevices(tenant, now)));

        assertThat(silent)
                .as("overdue is relative to the device's own cadence, not to wall-clock age")
                .containsExactly("expected-every-5-min", "expected-every-30-min");
    }

    @Test
    void anArchivedDeviceAndADeactivatedDeviceAreBothExcluded() {
        UUID tenant = UUID.randomUUID();
        UUID branch = UUID.randomUUID();
        Instant now = Instant.parse("2026-08-11T12:00:00Z");

        inTenant(tenant, branch, () -> {
            AttendanceDeviceEntity archived = device(tenant, branch, "archived", 300, null);
            archived.setArchivedAt(now.minus(2, ChronoUnit.DAYS));
            repository.save(archived);

            AttendanceDeviceEntity disabled = device(tenant, branch, "disabled", 300, null);
            disabled.setActive(false);
            repository.save(disabled);

            repository.save(device(tenant, branch, "genuinely-silent", 300, null));
            return null;
        });

        List<String> silent = serialsOf(inTenant(tenant, branch, () -> repository.findSilentDevices(tenant, now)));

        assertThat(silent)
                .as("a terminal somebody deliberately switched off must not warn on every sweep forever")
                .containsExactly("genuinely-silent");
    }

    @Test
    void theArchivedAwareLookupsDisagreeAboutAnArchivedDevice() {
        UUID tenant = UUID.randomUUID();
        UUID branch = UUID.randomUUID();
        UUID id = inTenant(tenant, branch, () -> {
            AttendanceDeviceEntity d = device(tenant, branch, "removed", 300, null);
            d.setArchivedAt(Instant.parse("2026-08-01T00:00:00Z"));
            return repository.save(d).getId();
        });

        inTenant(tenant, branch, () -> {
            assertThat(repository.findByIdAndTenantIdAndArchivedAtIsNull(id, tenant))
                    .as("a user cannot act on a device they removed")
                    .isEmpty();
            assertThat(repository.findByIdAndTenantIdIncludingArchived(id, tenant))
                    .as("but last month's punches must still resolve to the device that produced them")
                    .isPresent();
            assertThat(repository.findAllByTenantIdAndArchivedAtIsNullOrderByDisplayNameAsc(tenant))
                    .isEmpty();
            return null;
        });
    }

    // ---------------------------------------------------------------- helpers

    private AttendanceDeviceEntity newDevice(UUID tenant, UUID branch) {
        return device(tenant, branch, "SN-schema-" + UUID.randomUUID(), 900, null);
    }

    private AttendanceDeviceEntity device(UUID tenant, UUID branch, String serial, int intervalSeconds,
                                          Instant lastSeen) {
        AttendanceDeviceEntity d = new AttendanceDeviceEntity();
        d.setTenantId(tenant);
        d.setBranchId(branch);
        d.setSerialNo(serial);
        d.setModel("ZKTeco");
        d.setConnectionMode(ConnectionMode.NETWORK_ADMS);
        d.setDeviceToken("token-" + UUID.randomUUID());
        d.setActive(true);
        d.setExpectedContactIntervalSeconds(intervalSeconds);
        d.setLastSeenAt(lastSeen);
        return d;
    }

    private static List<String> serialsOf(List<AttendanceDeviceEntity> devices) {
        return devices.stream().map(AttendanceDeviceEntity::getSerialNo).toList();
    }

    private <T> T inTenant(UUID tenant, UUID branch, java.util.function.Supplier<T> body) {
        tenantContext.set(tenant, branch, UUID.randomUUID(), null);
        try {
            return body.get();
        } finally {
            tenantContext.clear();
        }
    }
}
