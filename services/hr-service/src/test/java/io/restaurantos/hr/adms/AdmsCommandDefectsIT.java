package io.restaurantos.hr.adms;

import org.junit.jupiter.api.Test;

import java.net.http.HttpResponse;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * DEFECT REGISTRY — the command channel. <b>Owner: plan 25-07.</b>
 *
 * <p><b>Inversion protocol.</b> Every case asserts a defect <em>still reproduces</em>; red means fixed.
 * Plan 25-07 inverts each case and <b>deletes it</b>, and deletes this class when the last one goes.
 *
 * <p>Neither case here loses data. They are here because each is a thing a physical terminal would
 * otherwise have to settle, and both can be removed from the hardware list for free — which is exactly
 * what D-25-04 asks for.
 */
class AdmsCommandDefectsIT extends AdmsWireTestBase {

    /**
     * ADMS-CMD-01 — an empty command queue answers with a zero-length body.
     *
     * <p>{@code DeviceCommandQueueService.pendingCommandsFor} returns the empty string, so a device
     * polling with nothing queued receives 200 and no bytes. The Go reference implementation, probed
     * against real hardware, and the PHP package both return the two-character acknowledgement
     * instead. Whether a given firmware tolerates a zero-length 200 on this endpoint is unverified,
     * and returning the acknowledgement costs nothing — so this is a question that need never be put
     * to a terminal at all.
     */
    @Test
    void anEmptyCommandQueueAnswersWithZeroBytesRatherThanTheAcknowledgement() throws Exception {
        Fixture fx = register(null);

        HttpResponse<String> res = getRequest(fx.serial(), fx.token());

        assertThat(res.statusCode()).isEqualTo(200);
        assertThat(res.body())
                .as("two reference implementations return OK here; this returns nothing")
                .isEmpty();
    }

    /**
     * ADMS-CMD-02 — the acknowledgement endpoint accepts any body and reconciles nothing.
     *
     * <p>{@code recordAck} is an empty method. A device reporting that a command failed is answered
     * exactly as one reporting success, and neither is stored. There is no queue for a command to be
     * in, so today this is consistent rather than wrong — it is pinned so that 25-07, which builds the
     * durable queue, is forced to give the acknowledgement somewhere to land at the same time. A queue
     * whose acknowledgements are discarded is a queue that can never drain.
     */
    @Test
    void anAcknowledgementForACommandThatWasNeverIssuedIsAcceptedAndDiscarded() throws Exception {
        Fixture fx = register(null);

        HttpResponse<String> res = http.send(java.net.http.HttpRequest.newBuilder(java.net.URI.create(
                                base() + "/iclock/devicecmd?SN=" + enc(fx.serial()) + "&token=" + enc(fx.token())))
                        .header("Content-Type", "text/plain;charset=UTF-8")
                        .POST(java.net.http.HttpRequest.BodyPublishers.ofString(
                                "ID=99999&Return=-1&CMD=DATA", java.nio.charset.StandardCharsets.UTF_8))
                        .build(),
                HttpResponse.BodyHandlers.ofString(java.nio.charset.StandardCharsets.UTF_8));

        assertThat(res.statusCode()).isEqualTo(200);
        assertThat(res.body().trim())
                .as("a failure report for an unknown command id is answered exactly like a success")
                .isEqualTo("OK");
    }
}
