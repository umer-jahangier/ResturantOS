package io.restaurantos.hr.adms;

import io.restaurantos.hr.entity.AttendanceDeviceEntity;
import io.restaurantos.hr.repository.AttendanceDeviceRepository;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import java.net.URI;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.time.Instant;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * The upload path can no longer lose a punch to a header or to a return type — asserted over real
 * HTTP, because none of it is visible from a method call.
 *
 * <p>These assertions replace the four cases 25-01 pinned in {@code AdmsBodyDefectsIT}, which this
 * plan owns and has therefore deleted. They are deliberately NOT added to {@code AdmsHttpContractIT}:
 * 25-01 froze that as the pre-phase baseline so a regression in it stays distinguishable from a
 * change of scope.
 *
 * <p>What was at stake: each of these paths ended with HTTP 200, the two-character acknowledgement
 * the device waits for, zero rows written and nothing logged. The terminal then deletes its offline
 * buffer. Over the internet — which is where this product runs — it is worse, not better: a terminal
 * on a flaky connection retries more and has more chance of believing a lie.
 */
class AdmsBodyContractIT extends AdmsWireTestBase {

    @Autowired AttendanceDeviceRepository repository;

    private HttpResponse<String> upload(String serial, String token, String contentTypeOrNull, String body)
            throws Exception {
        HttpRequest.Builder b = HttpRequest.newBuilder(URI.create(
                        base() + "/iclock/cdata?SN=" + enc(serial) + "&table=ATTLOG&Stamp=9999"
                                + (token == null ? "" : "&token=" + enc(token))))
                .POST(HttpRequest.BodyPublishers.ofString(body, StandardCharsets.UTF_8));
        if (contentTypeOrNull != null) {
            b.header("Content-Type", contentTypeOrNull);
        }
        return http.send(b.build(), HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
    }

    /**
     * The headline inversion. A {@code Content-Type} the device chose used to decide whether an
     * employee got paid: form encoding had the container drain the body into the parameter map, the
     * body binding saw an empty stream, and the batch was discarded with a success acknowledgement.
     */
    @Test
    void plainTextFormEncodedAndNoContentTypeAllWriteTheSameRows() throws Exception {
        Fixture plain = register("6001");
        Fixture form = register("6002");
        Fixture none = register("6003");

        HttpResponse<String> a = upload(plain.serial(), plain.token(), "text/plain;charset=UTF-8",
                "6001\t2026-06-15 09:30:00\t0\t1\n");
        HttpResponse<String> b = upload(form.serial(), form.token(), "application/x-www-form-urlencoded",
                "6002\t2026-06-15 09:30:00\t0\t1\n");
        HttpResponse<String> c = upload(none.serial(), none.token(), null,
                "6003\t2026-06-15 09:30:00\t0\t1\n");

        assertThat(countPunchesByRef("6001")).isEqualTo(1);
        assertThat(countPunchesByRef("6002"))
                .as("a header the device chose must not decide whether a punch exists")
                .isEqualTo(1);
        assertThat(countPunchesByRef("6003"))
                .as("firmware that sends no Content-Type at all is still delivering punches")
                .isEqualTo(1);

        for (HttpResponse<String> res : java.util.List.of(a, b, c)) {
            assertThat(res.statusCode()).isEqualTo(200);
            assertThat(res.body().trim())
                    .as("the wire reply is unchanged in every case — the device's retry logic depends on it")
                    .isEqualTo("OK");
        }
    }

    @Test
    void aBatchOfFiveWithTwoMalformedWritesThreePunchesAndStillAnswersOk() throws Exception {
        Fixture fx = register("6010");
        String body = String.join("\n",
                "6010\t2026-06-15 09:00:00\t0\t1",
                "6010\tnot-a-timestamp\t0\t1",
                "6010\t2026-06-15 12:00:00\t1\t1",
                "\t2026-06-15 13:00:00\t0\t1",
                "6010\t2026-06-15 17:00:00\t1\t1") + "\n";

        HttpResponse<String> res = upload(fx.serial(), fx.token(), "text/plain;charset=UTF-8", body);

        assertThat(res.statusCode()).isEqualTo(200);
        assertThat(res.body().trim()).isEqualTo("OK");
        assertThat(countPunchesByRef("6010"))
                .as("one bad line does not take the good ones with it")
                .isEqualTo(3);
    }

    @Test
    void aBodyOfOnlyMalformedLinesWritesNothingAndStillAnswersOk() throws Exception {
        Fixture fx = register(null);

        HttpResponse<String> res = upload(fx.serial(), fx.token(), "text/plain;charset=UTF-8",
                "garbage\nmore garbage\n");

        assertThat(res.statusCode()).isEqualTo(200);
        assertThat(res.body().trim())
                .as("a zero-yield batch becomes visible on the SERVER, never in what the device is told")
                .isEqualTo("OK");
        assertThat(countPunchesForDevice(fx.serial())).isZero();
    }

    /** An epoch already names an instant, so no device offset may be applied to it. */
    @Test
    void anEpochTimestampedLineWritesAPunchAtExactlyThatInstant() throws Exception {
        Fixture fx = register("6020");

        assertThat(upload(fx.serial(), fx.token(), "text/plain;charset=UTF-8",
                "6020\t1781512200\t0\t1\n").statusCode()).isEqualTo(200);

        assertThat(reportedAt("6020")).isEqualTo(Instant.ofEpochSecond(1781512200L));
    }

    /** The reference parser identifies a punch from two fields; requiring four discarded whole firmwares. */
    @Test
    void aThreeFieldLineWritesAPunch() throws Exception {
        Fixture fx = register("6030");

        assertThat(upload(fx.serial(), fx.token(), "text/plain;charset=UTF-8",
                "6030\t2026-06-15 09:30:00\t0\n").statusCode()).isEqualTo(200);

        assertThat(countPunchesByRef("6030")).isEqualTo(1);
    }

    /**
     * A device in another country. Before 25-05 the zone was a constant compiled into the parser, so
     * every punch from such a device was stored hours out with a plausible-looking time that nothing
     * would flag.
     *
     * <p>The two timestamp columns are asserted separately, in one row: a future change that quietly
     * derives one from the other fails here.
     */
    @Test
    void aDeviceWithANonDefaultTimezoneStoresAnInstantConsistentWithThatZone() throws Exception {
        Fixture fx = register("6040");
        setTimezone(fx.serial(), "Europe/London"); // UTC+1 in June, vs Asia/Karachi's UTC+5

        assertThat(upload(fx.serial(), fx.token(), "text/plain;charset=UTF-8",
                "6040\t2026-06-15 09:30:00\t0\t1\n").statusCode()).isEqualTo(200);

        try (Connection c = jdbc();
             PreparedStatement ps = c.prepareStatement(
                     "SELECT device_reported_at, server_received_at FROM attendance_punches "
                             + "WHERE device_user_ref = ?")) {
            ps.setString(1, "6040");
            try (ResultSet rs = ps.executeQuery()) {
                assertThat(rs.next()).isTrue();
                Instant reported = rs.getTimestamp(1).toInstant();
                Instant received = rs.getTimestamp(2).toInstant();
                assertThat(reported)
                        .as("09:30 London is 08:30Z, not 04:30Z — the device's own zone was used")
                        .isEqualTo(Instant.parse("2026-06-15T08:30:00Z"));
                assertThat(received).isAfter(reported).isNotEqualTo(reported);
            }
        }
    }

    // ---------------------------------------------------------------- helpers

    /** The management API that would set this is 25-09's, so the fixture writes it directly. */
    private void setTimezone(String serial, String zone) {
        AttendanceDeviceEntity d = repository.resolveBySerial(serial).orElseThrow();
        d.setDeviceTimezone(zone);
        tenantContext.set(d.getTenantId(), d.getBranchId(), UUID.randomUUID(), null);
        try {
            repository.save(d);
        } finally {
            tenantContext.clear();
        }
    }

    private Instant reportedAt(String ref) throws Exception {
        try (Connection c = jdbc();
             PreparedStatement ps = c.prepareStatement(
                     "SELECT device_reported_at FROM attendance_punches WHERE device_user_ref = ?")) {
            ps.setString(1, ref);
            try (ResultSet rs = ps.executeQuery()) {
                return rs.next() ? rs.getTimestamp(1).toInstant() : null;
            }
        }
    }
}
