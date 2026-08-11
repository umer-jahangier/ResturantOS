package io.restaurantos.hr.adms;

import io.restaurantos.hr.entity.AttendancePunchEntity.PunchType;
import io.restaurantos.hr.entity.AttendanceQuarantineEntity;
import io.restaurantos.hr.entity.AttendanceQuarantineEntity.Reason;
import io.restaurantos.hr.entity.AttendanceQuarantineEntity.Status;
import io.restaurantos.hr.repository.AttendanceQuarantineRepository;
import io.restaurantos.hr.service.PunchIngestService;
import io.restaurantos.hr.service.PunchIngestService.SuppliedInterpretation;
import io.restaurantos.shared.event.OutboxEntry;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.annotation.Autowired;

import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.atLeast;
import static org.mockito.Mockito.verify;

/**
 * Phase 25's accounting test: <b>every line a device sends ends in one of exactly three places</b> —
 * an attendance punch, a resolvable queue entry, or a recorded duplicate of something already in one
 * of the first two — and there is no fourth place (D-25-03).
 *
 * <h2>Why the central assertion is a sum</h2>
 *
 * <p>A per-case assertion passes while a line quietly falls between two cases: each case looks at
 * the rows it expects and none of them looks at the total. That is precisely the shape of the defect
 * this plan fixes — a rejected line produced a warning and no row, and every existing test still
 * passed, because no test added anything up. {@link #mixedBatchOfTenAccountsForEveryLineOverThreeReplays}
 * asserts the total.
 *
 * <h2>Everything here is over real HTTP</h2>
 *
 * <p>The counts are read from the database with JDBC, not from a service return value, for the same
 * reason 25-05 built {@code AdmsBodyContractIT}: a direct method call cannot see a defect that lives
 * between the container and the controller, and two of the four silent-loss paths that plan closed
 * lived exactly there. {@code scripts/adms-sim/scenarios.py} runs the same shapes through the
 * gateway in 25-13; the shapes are reproduced here so the two agree by construction.
 */
class PunchRetentionIT extends AdmsWireTestBase {

    @Autowired AttendanceQuarantineRepository quarantineRepository;
    @Autowired io.restaurantos.hr.repository.EmployeeRepository employeeRepository;
    @Autowired PunchIngestService punchIngestService;

    private static final String TEXT = "text/plain;charset=UTF-8";

    // ---------------------------------------------------------------- the three destinations

    @Test
    void aMappedReferenceWritesAPunchAndOneEvent_andAReplayWritesNothingAndPublishesNothing() throws Exception {
        Fixture fx = register("5001");
        String body = "5001\t2026-06-15 09:30:00\t0\t1\tWC-7";

        assertThat(attlog(fx.serial(), fx.token(), TEXT, body).statusCode()).isEqualTo(200);
        assertThat(countPunchesForDevice(fx.serial())).isEqualTo(1);
        assertThat(punchEventsFor(fx.serial())).isEqualTo(1);

        assertThat(attlog(fx.serial(), fx.token(), TEXT, body).statusCode()).isEqualTo(200);
        assertThat(attlog(fx.serial(), fx.token(), TEXT, body).statusCode()).isEqualTo(200);
        assertThat(countPunchesForDevice(fx.serial())).isEqualTo(1);
        assertThat(punchEventsFor(fx.serial())).isEqualTo(1); // no duplicate path publishes
    }

    @Test
    void anUnmappedReferenceWritesOneQueueEntryCarryingTheReasonAndTheRawLine() throws Exception {
        Fixture fx = register(null);
        String line = "6001\t2026-06-15 09:00:00\t0\t1";

        attlog(fx.serial(), fx.token(), TEXT, line);

        List<AttendanceQuarantineEntity> pending = pendingFor(fx);
        assertThat(pending).hasSize(1);
        assertThat(pending.getFirst().getReason()).isEqualTo(Reason.UNMAPPED_DEVICE_USER);
        assertThat(pending.getFirst().getDeviceUserRef()).isEqualTo("6001");
        assertThat(pending.getFirst().getDeviceReportedAt()).isNotNull();
        assertThat(pending.getFirst().getRawLine()).isEqualTo(line);
        assertThat(countPunchesForDevice(fx.serial())).isZero();
        assertThat(punchEventsFor(fx.serial())).isZero();
    }

    /**
     * THE DEFECT. Before changelog 034 the queue had no uniqueness constraint of any kind and the
     * ingest service inserted into it unconditionally, so this produced three rows — one per replay,
     * without bound, for a terminal polling every three to eight seconds.
     */
    @Test
    void theSameUnmappedPunchSentThreeTimesWritesExactlyOneQueueEntry() throws Exception {
        Fixture fx = register(null);
        String line = "6002\t2026-06-15 09:00:00\t0\t1";

        attlog(fx.serial(), fx.token(), TEXT, line);
        attlog(fx.serial(), fx.token(), TEXT, line);
        attlog(fx.serial(), fx.token(), TEXT, line);

        assertThat(countQuarantineForDevice(fx.serial())).isEqualTo(1);
    }

    @Test
    void twoDifferentUnmappedPunchesFromOneDeviceWriteTwoEntries() throws Exception {
        Fixture fx = register(null);

        attlog(fx.serial(), fx.token(), TEXT, "6003\t2026-06-15 09:00:00\t0\t1");
        attlog(fx.serial(), fx.token(), TEXT, "6003\t2026-06-15 17:30:00\t1\t1");

        assertThat(countQuarantineForDevice(fx.serial())).isEqualTo(2);
    }

    @Test
    void anUninterpretableLineIsRetainedVerbatimWithNoReferenceAndNoInstant() throws Exception {
        Fixture fx = register(null);
        String line = "7001\tnot-a-timestamp\t0\t1";

        attlog(fx.serial(), fx.token(), TEXT, line);

        List<AttendanceQuarantineEntity> pending = pendingFor(fx);
        assertThat(pending).hasSize(1);
        AttendanceQuarantineEntity entry = pending.getFirst();
        assertThat(entry.getReason()).isEqualTo(Reason.UNPARSEABLE_TIMESTAMP);
        assertThat(entry.getRawLine()).isEqualTo(line); // verbatim: the only evidence there is
        assertThat(entry.getDeviceUserRef()).isNull();
        assertThat(entry.getDeviceReportedAt()).isNull();
        assertThat(entry.getReceivedAt()).isNotNull(); // still has a position in time
    }

    @Test
    void everyRejectionReasonReachesTheQueueAndReplayingThemAddsNothing() throws Exception {
        Fixture fx = register(null);
        String tooFewFields = "garbage-with-no-tab-at-all";
        String missingRef = "\t2026-06-15 09:00:00\t0\t1";
        String badTimestamp = "7002\tnot-a-timestamp\t0\t1";
        String body = tooFewFields + "\n" + missingRef + "\n" + badTimestamp;

        attlog(fx.serial(), fx.token(), TEXT, body);
        assertThat(countQuarantineForDevice(fx.serial())).isEqualTo(3);
        assertThat(pendingFor(fx)).extracting(AttendanceQuarantineEntity::getReason)
                .containsExactlyInAnyOrder(Reason.TOO_FEW_FIELDS, Reason.MISSING_DEVICE_USER_REF,
                        Reason.UNPARSEABLE_TIMESTAMP);

        attlog(fx.serial(), fx.token(), TEXT, body);
        attlog(fx.serial(), fx.token(), TEXT, body);
        assertThat(countQuarantineForDevice(fx.serial())).isEqualTo(3);

        // A DIFFERENT bad line is a different thing the device sent, and gets its own entry.
        attlog(fx.serial(), fx.token(), TEXT, "7003\talso-not-a-timestamp\t0\t1");
        assertThat(countQuarantineForDevice(fx.serial())).isEqualTo(4);
        assertThat(punchEventsFor(fx.serial())).isZero();
    }

    // ---------------------------------------------------------------- resolve and dismiss

    /**
     * The behaviour {@code AdmsIngestIT.unmappedRef_quarantines_thenResolveEstablishesDurableMapping}
     * already guarantees, asserted again here so that this plan's changes to the resolve path are
     * pinned as byte-for-byte unchanged for the shape that was already right.
     */
    @Test
    void resolvingAnUnmappedEntryEstablishesTheDurableMappingAndRefusesToRepointIt() throws Exception {
        Fixture fx = register(null);
        UUID alice = employeeIn(fx, "Alice");
        UUID bob = employeeIn(fx, "Bob");

        attlog(fx.serial(), fx.token(), TEXT, "6100\t2026-06-15 09:00:00\t0\t1");
        UUID entryId = pendingFor(fx).getFirst().getId();

        tenantContext.set(fx.tenant(), fx.branch(), UUID.randomUUID(), null);
        try {
            punchIngestService.resolveQuarantine(entryId, alice);
            assertThat(quarantineRepository.findById(entryId).orElseThrow().getStatus()).isEqualTo(Status.RESOLVED);
        } finally {
            tenantContext.clear();
        }
        assertThat(countPunchesByRef("6100")).isEqualTo(1); // the parked punch was re-ingested

        // Every SUBSEQUENT punch for that reference auto-resolves — no second entry, ever.
        attlog(fx.serial(), fx.token(), TEXT, "6100\t2026-06-16 09:00:00\t0\t1");
        assertThat(countPunchesByRef("6100")).isEqualTo(2);
        assertThat(pendingFor(fx)).isEmpty();

        // Re-pointing a reference at a SECOND employee is refused. The race this guards is real: a
        // punch for 6101 queues while unmapped, an administrator then maps 6101 to Bob on the
        // employee screen, and a second administrator tries to resolve the parked entry to Alice.
        // Whichever of them is wrong, silently paying one person for the other's hours is worse than
        // a refusal somebody has to read.
        attlog(fx.serial(), fx.token(), TEXT, "6101\t2026-06-15 09:00:00\t0\t1");
        UUID second = pendingFor(fx).getFirst().getId();
        tenantContext.set(fx.tenant(), fx.branch(), UUID.randomUUID(), null);
        try {
            io.restaurantos.hr.entity.EmployeeEntity bobRow =
                    employeeRepository.findByIdAndTenantId(bob, fx.tenant()).orElseThrow();
            bobRow.setDeviceUserRef("6101");
            employeeRepository.save(bobRow);

            assertThatThrownBy(() -> punchIngestService.resolveQuarantine(second, alice))
                    .isInstanceOf(IllegalStateException.class)
                    .hasMessageContaining("already mapped to another employee");
            assertThat(quarantineRepository.findById(second).orElseThrow().getStatus()).isEqualTo(Status.PENDING);
        } finally {
            tenantContext.clear();
        }
    }

    @Test
    void resolvingAnUninterpretableEntryIsRefusedWithoutAnInterpretationAndSucceedsWithOne() throws Exception {
        Fixture fx = register(null);
        UUID employee = employeeIn(fx, "Carol");
        attlog(fx.serial(), fx.token(), TEXT, "6200\tnot-a-timestamp\t0\t1");
        UUID entryId = pendingFor(fx).getFirst().getId();

        tenantContext.set(fx.tenant(), fx.branch(), UUID.randomUUID(), null);
        try {
            // A parser that could not read a line must not be replaced by a service that assumes one.
            assertThatThrownBy(() -> punchIngestService.resolveQuarantine(entryId, employee))
                    .isInstanceOf(IllegalArgumentException.class)
                    .hasMessageContaining("will not guess");
            assertThat(quarantineRepository.findById(entryId).orElseThrow().getStatus()).isEqualTo(Status.PENDING);

            punchIngestService.resolveQuarantine(entryId, employee, new SuppliedInterpretation(
                    "6200", Instant.parse("2026-06-15T04:00:00Z"), PunchType.IN));
            assertThat(quarantineRepository.findById(entryId).orElseThrow().getStatus()).isEqualTo(Status.RESOLVED);
        } finally {
            tenantContext.clear();
        }
        assertThat(countPunchesByRef("6200")).isEqualTo(1);
    }

    @Test
    void dismissalRecordsWhoAndWhy_writesNoPunch_andIsRefusedWithoutAReason() throws Exception {
        Fixture fx = register(null);
        UUID actor = UUID.randomUUID();
        attlog(fx.serial(), fx.token(), TEXT, "6300\t2026-06-15 09:00:00\t0\t1");
        UUID entryId = pendingFor(fx).getFirst().getId();

        tenantContext.set(fx.tenant(), fx.branch(), actor, null);
        try {
            assertThatThrownBy(() -> punchIngestService.dismissQuarantine(entryId, "  "))
                    .isInstanceOf(IllegalArgumentException.class);
            assertThat(quarantineRepository.findById(entryId).orElseThrow().getStatus()).isEqualTo(Status.PENDING);

            punchIngestService.dismissQuarantine(entryId, "Test punch during commissioning; no employee involved.");
            AttendanceQuarantineEntity dismissed = quarantineRepository.findById(entryId).orElseThrow();
            assertThat(dismissed.getStatus()).isEqualTo(Status.DISMISSED);
            assertThat(dismissed.getDismissedBy()).isEqualTo(actor);
            assertThat(dismissed.getDismissedAt()).isNotNull();
            assertThat(dismissed.getDismissalReason()).contains("commissioning");
        } finally {
            tenantContext.clear();
        }
        assertThat(countPunchesByRef("6300")).isZero();
        assertThat(punchEventsFor(fx.serial())).isZero();
    }

    /**
     * The service refuses a reasonless dismissal, and so does the table. A service check is a promise
     * about one code path; the constraint is a promise about the table, and 25-09's endpoints and
     * 25-12's screen are two more code paths that have not been written yet.
     */
    @Test
    void theDatabaseItselfRefusesADismissalWithNoNameAndNoReason() throws Exception {
        Fixture fx = register(null);
        attlog(fx.serial(), fx.token(), TEXT, "6400\t2026-06-15 09:00:00\t0\t1");
        UUID entryId = pendingFor(fx).getFirst().getId();

        try (Connection c = jdbc();
             PreparedStatement ps = c.prepareStatement(
                     "UPDATE attendance_quarantine SET status = 'DISMISSED' WHERE id = ?")) {
            ps.setObject(1, entryId);
            assertThatThrownBy(ps::executeUpdate)
                    .hasMessageContaining("ck_attendance_quarantine_dismissal");
        }
    }

    // ---------------------------------------------------------------- the accounting

    /**
     * Ten lines in, ten lines accounted for, three times over. The assertion is the SUM; the
     * individual counts are printed alongside it only so a failure says which bucket moved.
     */
    @Test
    void mixedBatchOfTenAccountsForEveryLineOverThreeReplays() throws Exception {
        Fixture fx = register("8001");
        String body = String.join("\n",
                "8001\t2026-06-15 09:00:00\t0\t1",      // mapped   -> punch
                "8001\t2026-06-15 13:00:00\t1\t1",      // mapped   -> punch
                "8001\t2026-06-15 17:00:00\t1\t1",      // mapped   -> punch
                "8001\t2026-06-15 09:00:00\t0\t1",      // repeated within the batch -> duplicate
                "8002\t2026-06-15 09:05:00\t0\t1",      // unmapped -> queue entry
                "8002\t2026-06-15 17:05:00\t1\t1",      // unmapped -> queue entry
                "8002\t2026-06-15 09:05:00\t0\t1",      // repeated within the batch -> duplicate
                "garbage-with-no-tab-at-all",           // rejected -> queue entry
                "\t2026-06-15 09:00:00\t0\t1",          // rejected -> queue entry
                "8003\tnot-a-timestamp\t0\t1");         // rejected -> queue entry

        for (int replay = 1; replay <= 3; replay++) {
            assertThat(attlog(fx.serial(), fx.token(), TEXT, body).statusCode()).isEqualTo(200);

            int punches = countPunchesForDevice(fx.serial());
            int entries = countQuarantineForDevice(fx.serial());
            assertThat(punches + entries)
                    .as("replay %d: punches=%d entries=%d — every one of the ten lines must have a "
                            + "destination, and a replay must add none", replay, punches, entries)
                    .isEqualTo(3 + 2 + 3);
            assertThat(punches).as("replay %d punches", replay).isEqualTo(3);
            assertThat(entries).as("replay %d queue entries", replay).isEqualTo(5);
            assertThat(punchEventsFor(fx.serial()))
                    .as("replay %d: only the three genuine inserts ever published", replay)
                    .isEqualTo(3);
        }
    }

    /** An offline flush: twenty records accumulated behind a network blip, then sent, then re-sent. */
    @Test
    void anOfflineFlushOfTwentyRecordsReplayedLeavesTheSameRows() throws Exception {
        Fixture fx = register("8100");
        StringBuilder body = new StringBuilder();
        for (int minute = 0; minute < 20; minute++) {
            body.append(String.format("8100\t2026-06-15 09:%02d:00\t0\t1%n", minute));
        }

        attlog(fx.serial(), fx.token(), TEXT, body.toString());
        assertThat(countPunchesForDevice(fx.serial())).isEqualTo(20);

        attlog(fx.serial(), fx.token(), TEXT, body.toString());
        assertThat(countPunchesForDevice(fx.serial())).isEqualTo(20);
        assertThat(countQuarantineForDevice(fx.serial())).isZero();
        assertThat(punchEventsFor(fx.serial())).isEqualTo(20);
    }

    /**
     * Devices retransmit out of order. The uniqueness key does not depend on order and nothing
     * asserted that, which is the kind of assumption an optimisation introduces later.
     */
    @Test
    void aDescendingBatchStoresTheSameRowsAsTheAscendingOne() throws Exception {
        Fixture ascending = register("8200");
        Fixture descending = register("8200");
        String[] lines = {
                "8200\t2026-06-15 09:00:00\t0\t1",
                "8200\t2026-06-15 13:00:00\t1\t1",
                "8200\t2026-06-15 17:00:00\t1\t1",
                "8201\t2026-06-15 09:10:00\t0\t1",   // unmapped in both
                "8201\t2026-06-15 17:10:00\t1\t1"};

        attlog(ascending.serial(), ascending.token(), TEXT, String.join("\n", lines));
        StringBuilder reversed = new StringBuilder();
        for (int i = lines.length - 1; i >= 0; i--) {
            reversed.append(lines[i]).append('\n');
        }
        attlog(descending.serial(), descending.token(), TEXT, reversed.toString());

        assertThat(countPunchesForDevice(descending.serial()))
                .isEqualTo(countPunchesForDevice(ascending.serial())).isEqualTo(3);
        assertThat(countQuarantineForDevice(descending.serial()))
                .isEqualTo(countQuarantineForDevice(ascending.serial())).isEqualTo(2);
    }

    @Test
    void noRefusedPathPublishesAnything() throws Exception {
        Fixture fx = register("8300");

        assertThat(attlog(fx.serial(), "not-the-token", TEXT, "8300\t2026-06-15 09:00:00\t0\t1").statusCode())
                .isEqualTo(401);

        assertThat(countPunchesForDevice(fx.serial())).isZero();
        assertThat(countQuarantineForDevice(fx.serial())).isZero();
        // Deliberately NOT "the outbox was never touched" — registering the fixture's employee
        // legitimately publishes an employee event. The claim is narrower and the right one: a
        // refused device produced no ATTENDANCE row and therefore no ATTENDANCE_PUNCHED.
        assertThat(punchEventsFor(fx.serial())).isZero();
    }

    // ---------------------------------------------------------------- helpers

    private List<AttendanceQuarantineEntity> pendingFor(Fixture fx) {
        tenantContext.set(fx.tenant(), fx.branch(), UUID.randomUUID(), null);
        try {
            return quarantineRepository.findAllByTenantIdAndStatus(fx.tenant(), Status.PENDING);
        } finally {
            tenantContext.clear();
        }
    }

    private UUID employeeIn(Fixture fx, String name) {
        tenantContext.set(fx.tenant(), fx.branch(), UUID.randomUUID(), null);
        try {
            return employeeService.create(new io.restaurantos.hr.dto.EmployeeDtos.CreateEmployeeRequest(
                    "EMP-" + UUID.randomUUID(), name, null, null, null, null, null,
                    io.restaurantos.hr.entity.EmployeeEntity.EmploymentType.PERMANENT,
                    LocalDate.of(2025, 1, 1), 0L, null)).id();
        } finally {
            tenantContext.clear();
        }
    }

    /**
     * ATTENDANCE_PUNCHED events for one device, counted off the mocked outbox. Filtered by device id
     * rather than counted in bulk because a shared Spring context runs these classes together and a
     * bulk count would silently absorb another test's events.
     */
    private long punchEventsFor(String serial) throws Exception {
        UUID deviceId = deviceIdOf(serial);
        ArgumentCaptor<OutboxEntry> captor = ArgumentCaptor.forClass(OutboxEntry.class);
        verify(outboxRepository, atLeast(0)).save(captor.capture());
        return captor.getAllValues().stream()
                .filter(e -> "ATTENDANCE_PUNCHED".equals(e.getEventType()))
                .filter(e -> e.getEnvelopeJson() != null && e.getEnvelopeJson().contains(deviceId.toString()))
                .count();
    }

    private UUID deviceIdOf(String serial) throws Exception {
        try (Connection c = jdbc();
             PreparedStatement ps = c.prepareStatement("SELECT id FROM attendance_devices WHERE serial_no = ?")) {
            ps.setString(1, serial);
            try (ResultSet rs = ps.executeQuery()) {
                rs.next();
                return rs.getObject(1, UUID.class);
            }
        }
    }
}
