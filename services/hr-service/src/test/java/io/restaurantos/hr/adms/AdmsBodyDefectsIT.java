package io.restaurantos.hr.adms;

import org.junit.jupiter.api.Test;

import java.net.http.HttpResponse;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * DEFECT REGISTRY — silent data loss on the upload path. <b>Owner: plan 25-05.</b>
 *
 * <p><b>Inversion protocol.</b> Every case here asserts that a defect <em>still reproduces</em>. A case
 * going red means the product was fixed. Plan 25-05 inverts each case as part of its own work and
 * <b>deletes it</b>; when the last case goes, this class goes with it. A tolerance that outlives its
 * defect is worse than no registry at all.
 *
 * <p><b>What these three cost.</b> Each one ends with HTTP 200, the two-character success
 * acknowledgement the device is waiting for, zero rows written, and nothing logged. That is the same
 * failure shape as an audit log reporting healthy while sitting at zero rows for four days — and here
 * each lost row is an employee's unpaid hour, discovered at month-end as a dispute rather than as a
 * maintenance ticket. The device believes it delivered; it deletes its buffer; the punch is gone.
 */
class AdmsBodyDefectsIT extends AdmsWireTestBase {

    /**
     * ADMS-BODY-01 — a Content-Type the device chose silently discards the whole batch.
     *
     * <p>When a POST declares form encoding, the servlet container consumes the body into request
     * parameters before the handler runs. {@code @RequestBody(required = false) String body} then sees
     * an already-drained stream, and {@code AdmsController.cdataUpload}'s {@code body != null} guard
     * skips the ingest loop entirely. The documented happy path uses plain text, so a by-the-book
     * firmware does not hit this — but it is a data-loss branch selected by a header the device
     * chooses, and firmware varies. That is not a risk worth carrying for the sake of one guard clause.
     */
    @Test
    void aFormEncodedAttlogIsAcknowledgedAsSuccessAndWritesNothing() throws Exception {
        Fixture fx = register("5001");
        String ref = "5001";

        HttpResponse<String> res = attlog(fx.serial(), fx.token(),
                "application/x-www-form-urlencoded",
                ref + "\t2026-06-15 09:30:00\t0\t1\n");

        assertThat(res.statusCode()).isEqualTo(200);
        assertThat(res.body().trim())
                .as("the device is told it succeeded")
                .isEqualTo("OK");
        assertThat(countPunchesForDevice(fx.serial()))
                .as("...and nothing was written")
                .isZero();
        assertThat(countQuarantineForDevice(fx.serial()))
                .as("...and nothing was retained for anyone to find later either")
                .isZero();
    }

    /**
     * ADMS-BODY-02 — a Unix-epoch timestamp vanishes without a trace.
     *
     * <p>{@code AttlogLineParser} accepts exactly one timestamp pattern, {@code yyyy-MM-dd HH:mm:ss}.
     * Anything else throws inside the parse, is swallowed, and comes back as an empty Optional — which
     * is indistinguishable, to every caller, from a line that was never sent. The Go reference parser
     * probed against real hardware accepts an epoch. Firmware that emits one loses every punch it ever
     * sends, forever, silently.
     */
    @Test
    void anEpochTimestampIsDroppedWithNoRowNoQuarantineAndASuccessAcknowledgement() throws Exception {
        Fixture fx = register("5002");
        String ref = "5002";

        HttpResponse<String> res = attlog(fx.serial(), fx.token(), "text/plain;charset=UTF-8",
                ref + "\t1781512200\t0\t1\n");

        assertThat(res.statusCode()).isEqualTo(200);
        assertThat(res.body().trim()).isEqualTo("OK");
        assertThat(countPunchesByRef(ref)).isZero();
        assertThat(countQuarantineByRef(ref))
                .as("D-25-03 says a punch is never dropped; an unparseable line is dropped anyway")
                .isZero();
    }

    /**
     * ADMS-BODY-03 — a short line is dropped where the reference implementation reads it.
     *
     * <p>The parser requires four tab-separated fields. Both reference implementations identify a
     * punch from two — a PIN and a timestamp — and default the rest. A firmware that emits three
     * fields therefore loses every punch, again with a success acknowledgement and no record.
     */
    @Test
    void aThreeFieldLineIsDroppedWithNoRowAndNoQuarantine() throws Exception {
        Fixture fx = register("5003");
        String ref = "5003";

        HttpResponse<String> res = attlog(fx.serial(), fx.token(), "text/plain;charset=UTF-8",
                ref + "\t2026-06-15 09:30:00\t0\n");

        assertThat(res.statusCode()).isEqualTo(200);
        assertThat(res.body().trim()).isEqualTo("OK");
        assertThat(countPunchesByRef(ref)).isZero();
        assertThat(countQuarantineByRef(ref)).isZero();
    }

    /**
     * ADMS-BODY-04 — a batch is all-or-nothing about nothing: a bad line takes no others with it, but
     * neither does it leave any trace.
     *
     * <p>Pinned so that 25-05's repair is measured on the right axis. The property to keep is "one bad
     * line does not stop the batch"; the property to add is "the bad line still lands somewhere". Only
     * the first holds today.
     */
    @Test
    void aGoodLineBesideAnUnreadableOneSurvivesButTheUnreadableOneLeavesNoTrace() throws Exception {
        Fixture fx = register("5004");
        String badRef = "BAD-" + UUID.randomUUID().toString().substring(0, 8);

        HttpResponse<String> res = attlog(fx.serial(), fx.token(), "text/plain;charset=UTF-8",
                badRef + "\tnot-a-timestamp\t0\t1\n"
                        + "5004\t2026-06-15 09:30:00\t0\t1\n");

        assertThat(res.statusCode()).isEqualTo(200);
        assertThat(countPunchesByRef("5004"))
                .as("the readable line still lands — keep this when fixing the other half")
                .isEqualTo(1);
        assertThat(countQuarantineByRef(badRef))
                .as("the unreadable line lands nowhere at all")
                .isZero();
    }
}
