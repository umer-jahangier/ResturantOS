package io.restaurantos.hr.adms;

import io.restaurantos.hr.entity.AttendanceDeviceEntity;
import io.restaurantos.hr.repository.AttendanceDeviceRepository;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import java.net.http.HttpResponse;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * What a refused terminal actually receives, sent as real requests through the servlet stack.
 *
 * <p>{@code DeviceAuthResponseTest} proves the advice arrangement with MockMvc, which is where the
 * defect lived — but MockMvc does not answer the question a device asks. Only a real request does.
 *
 * <p>The assertions here replace the two cases 25-01 pinned in {@code AdmsAuthDefectsIT}, which this
 * plan owns and has therefore deleted, and the uniformity property that class also carried. They are
 * deliberately NOT added to {@code AdmsHttpContractIT}: 25-01 froze that class as the baseline of what
 * already worked before this phase, so a regression in the baseline stays distinguishable from a
 * change of scope.
 */
class DeviceAuthHttpIT extends AdmsWireTestBase {

    @Autowired AttendanceDeviceRepository repository;

    @Test
    void everyRefusalIsA401AndNotA500() throws Exception {
        Fixture fx = register(null);

        assertThat(handshake(fx.serial(), null).statusCode()).isEqualTo(401);
        assertThat(handshake(fx.serial(), "not-the-token").statusCode()).isEqualTo(401);
        assertThat(handshake("SN-nonexistent-" + UUID.randomUUID(), "anything").statusCode()).isEqualTo(401);
    }

    /**
     * Four causes, one answer — compared to each other, not each to a literal.
     *
     * <p>An endpoint that answers "no such device" differently from "that device exists, wrong token"
     * is a serial-number oracle, and a serial is the first half of the credential in every mode this
     * phase adds. This is the property 25-08 must not break when it introduces credential modes; its
     * own constraint 5 says so in the same words.
     */
    @Test
    void anUnknownSerialAWrongTokenAnInactiveDeviceAndAnArchivedDeviceAreIndistinguishable() throws Exception {
        Fixture known = register(null);
        Fixture inactive = register(null);
        Fixture archived = register(null);
        mutate(inactive.serial(), d -> d.setActive(false));
        mutate(archived.serial(), d -> d.setArchivedAt(Instant.now()));

        Map<String, HttpResponse<String>> refusals = new LinkedHashMap<>();
        refusals.put("unknown serial", handshake("SN-nonexistent-" + UUID.randomUUID(), "anything"));
        refusals.put("wrong token", handshake(known.serial(), "not-the-token"));
        refusals.put("no token", handshake(known.serial(), null));
        refusals.put("inactive device", handshake(inactive.serial(), inactive.token()));
        refusals.put("archived device", handshake(archived.serial(), archived.token()));

        String reference = shapeOf(refusals.get("unknown serial"));
        refusals.forEach((cause, res) -> assertThat(shapeOf(res))
                .as("'%s' must be indistinguishable from an unknown serial", cause)
                .isEqualTo(reference));
    }

    @Test
    void aRefusalLeaksNoSerialNoTokenAndNoCause() throws Exception {
        Fixture fx = register(null);

        String body = handshake(fx.serial(), "not-the-token").body();

        assertThat(body).contains("DEVICE_AUTH_FAILED");
        assertThat(body)
                .doesNotContain(fx.serial())
                .doesNotContain(fx.token())
                .doesNotContain("inactive")
                .doesNotContain("Invalid")
                .doesNotContain("Unknown");
    }

    @Test
    void noRefusedRequestWritesAPunchOrAQuarantineRow() throws Exception {
        Fixture fx = register("7001");

        attlog(fx.serial(), "not-the-token", "text/plain;charset=UTF-8",
                "7001\t2026-06-15 09:30:00\t0\t1\n");
        attlog("SN-nonexistent-" + UUID.randomUUID(), "anything", "text/plain;charset=UTF-8",
                "7001\t2026-06-15 09:31:00\t0\t1\n");
        attlog(fx.serial(), null, "text/plain;charset=UTF-8",
                "7001\t2026-06-15 09:32:00\t0\t1\n");

        assertThat(countPunchesByRef("7001")).isZero();
        assertThat(countQuarantineByRef("7001")).isZero();
    }

    /**
     * The refusal reaches the outbox despite the transaction that refused rolling back.
     *
     * <p>This is the assertion that {@code REQUIRES_NEW} on {@link DeviceAuthFailureEventPublisher} is
     * doing its job. Without it the outbox row is enqueued on {@code DeviceAuthResolver}'s transaction
     * — which exits by throwing — so the row rolls back, the audit trail records nothing, and the
     * system looks healthy while every refusal is invisible. That failure would be silent in exactly
     * the way this phase exists to stop.
     *
     * <p>Asserted against the mocked {@code OutboxRepository} from {@code HrTestBase}, which is the
     * seam every other event assertion in this suite uses; a rolled-back save would never reach it.
     */
    @Test
    void aRefusalAgainstAKnownDeviceReachesTheOutboxDespiteTheRollback() throws Exception {
        Fixture fx = register(null);

        handshake(fx.serial(), "not-the-token");

        org.mockito.ArgumentCaptor<io.restaurantos.shared.event.OutboxEntry> captor =
                org.mockito.ArgumentCaptor.forClass(io.restaurantos.shared.event.OutboxEntry.class);
        org.mockito.Mockito.verify(outboxRepository, org.mockito.Mockito.atLeastOnce()).save(captor.capture());

        assertThat(captor.getAllValues().stream()
                .filter(e -> "DEVICE_AUTH_FAILED".equals(e.getEventType()))
                .filter(e -> fx.tenant().equals(e.getTenantId()))
                .count())
                .as("REQUIRES_NEW: the refusal survives the transaction that refused")
                .isEqualTo(1);

        assertThat(captor.getAllValues().stream()
                .filter(e -> "DEVICE_AUTH_FAILED".equals(e.getEventType()))
                .noneMatch(e -> e.getEnvelopeJson() != null && e.getEnvelopeJson().contains(fx.token())))
                .as("no token material reaches the audit trail")
                .isTrue();
    }

    // ---------------------------------------------------------------- helpers

    /** Everything comparable about a refusal: the trace id is per-request and carries no device information. */
    private static String shapeOf(HttpResponse<String> res) {
        return res.statusCode() + "|"
                + res.body().replaceAll("\"traceId\"\\s*:\\s*\"[^\"]*\"", "\"traceId\":\"*\"");
    }

    private void mutate(String serial, java.util.function.Consumer<AttendanceDeviceEntity> change) {
        AttendanceDeviceEntity d = repository.resolveBySerial(serial).orElseThrow();
        change.accept(d);
        tenantContext.set(d.getTenantId(), d.getBranchId(), UUID.randomUUID(), null);
        try {
            repository.save(d);
        } finally {
            tenantContext.clear();
        }
    }

}
