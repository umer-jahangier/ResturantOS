package io.restaurantos.hr.adms;

import org.junit.jupiter.api.Test;

import java.net.http.HttpResponse;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * DEFECT REGISTRY — device-authentication status codes. <b>Owner: plan 25-04.</b>
 *
 * <h2>The inversion protocol these registries run on</h2>
 *
 * <p>Each case in a phase-25 defect registry asserts that a tolerated defect <em>still reproduces</em>.
 * A case going red therefore means the product was fixed, not that the test broke. The owning plan
 * named above inverts each case as part of its own work and <b>deletes it</b>; when the last case in a
 * registry is deleted, the registry class is deleted with it. The failure mode of a tolerance list is
 * a tolerance that outlives its defect.
 *
 * <h2>This registry is a special case: its defect was fixed before the phase ran</h2>
 *
 * <p>The plan expected two reproducing cases here — a handshake with no token and a handshake with a
 * wrong token, each answered {@code 500 INTERNAL_ERROR} instead of {@code 401}. Neither reproduces.
 * Commit {@code 174f24f}, landed on 2026-08-11 a few hours before this plan ran, added
 * {@code HrExceptionHandler.handleDeviceAuth} and both now answer 401. Measured live through the real
 * gateway on the same day:
 *
 * <pre>
 * GET /iclock/cdata?SN=UNKNOWN-DEVICE-999&amp;options=all&amp;pushver=2.4.0  ->  HTTP/1.1 401 Unauthorized
 * {"error":{"code":"DEVICE_AUTH_FAILED","message":"Device not recognised", ...}}
 * </pre>
 *
 * <p>Plan 25-01 instructs that a case which does not reproduce is recorded in the inventory as ALREADY
 * FIXED and not forced. So these two cases are written the other way up: they assert the <em>correct</em>
 * behaviour, and they are a regression guard rather than a tolerance. Concretely, they fail if anyone
 * removes {@code HrExceptionHandler}'s device handler, or removes its {@code HIGHEST_PRECEDENCE} order
 * and lets the shared advice's {@code @ExceptionHandler(Exception.class)} win again.
 *
 * <p>25-04 therefore inherits a smaller task than its plan assumed, and a different one: its remaining
 * work is the uniformity of the refusal (every refusal byte-identical whatever the cause) and the
 * circuit-breaker status list, not the status code. The third case below pins the uniformity property
 * that 25-04 must preserve and that 25-08 must not break when it adds credential modes.
 *
 * <p>Why the status mattered enough to be worth a commit of its own: an ADMS terminal polls every three
 * to eight seconds forever. An unknown serial produced an unhandled-exception stack trace at that
 * cadence — a log flood that buries real failures and fills a disk — and a device that could never
 * learn it was unauthorised, because 500 reads as "the server is broken, retry" while 401 reads as
 * "you are not enrolled".
 */
class AdmsAuthDefectsIT extends AdmsWireTestBase {

    /** ADMS-AUTH-01 — was: 500 on a tokenless handshake. Fixed by 174f24f; now a regression guard. */
    @Test
    void aHandshakeWithNoTokenIsRefused401AndNot500() throws Exception {
        Fixture fx = register(null);

        HttpResponse<String> res = handshake(fx.serial(), null);

        assertThat(res.statusCode())
                .as("the exact request a stock ZKTeco sends on boot: its menu has no token field")
                .isEqualTo(401);
        assertThat(res.body()).contains("DEVICE_AUTH_FAILED");
    }

    /** ADMS-AUTH-02 — was: 500 on a wrong token. Fixed by 174f24f; now a regression guard. */
    @Test
    void aHandshakeWithAWrongTokenIsRefused401AndNot500() throws Exception {
        Fixture fx = register(null);

        HttpResponse<String> res = handshake(fx.serial(), "not-the-token");

        assertThat(res.statusCode()).isEqualTo(401);
        assertThat(res.body()).contains("DEVICE_AUTH_FAILED");
    }

    /**
     * ADMS-AUTH-03 — every refusal is indistinguishable, whatever the cause.
     *
     * <p>Asserted by comparing responses to each other rather than by reading each one, which is the
     * only form of the assertion that cannot drift: three causes that each independently satisfy a
     * written expectation can still differ from one another. An attacker probing serial numbers must
     * not be able to tell "no such device" from "that device exists, wrong token" — the first answer
     * is a serial-number oracle.
     *
     * <p>This case does NOT reproduce a defect; it pins a property. 25-04 must preserve it when it
     * consolidates the handler, and 25-08 must preserve it when it adds credential modes — that plan's
     * own constraint 5 says so in the same words.
     */
    @Test
    void aRefusalLooksTheSameWhateverTheCause() throws Exception {
        Fixture known = register(null);
        Fixture inactive = register(null);
        tenantContext.set(inactive.tenant(), inactive.branch(), UUID.randomUUID(), null);
        try {
            deviceService.list().stream()
                    .filter(d -> d.serialNo().equals(inactive.serial()))
                    .forEach(d -> deviceService.deactivate(d.id()));
        } finally {
            tenantContext.clear();
        }

        HttpResponse<String> unknownSerial = handshake("SN-does-not-exist-" + UUID.randomUUID(), "anything");
        HttpResponse<String> wrongToken = handshake(known.serial(), "not-the-token");
        HttpResponse<String> deactivated = handshake(inactive.serial(), inactive.token());

        assertThat(unknownSerial.statusCode()).isEqualTo(wrongToken.statusCode());
        assertThat(unknownSerial.statusCode()).isEqualTo(deactivated.statusCode());
        assertThat(refusalShape(unknownSerial))
                .as("an unknown serial and a wrong token must not be distinguishable")
                .isEqualTo(refusalShape(wrongToken));
        assertThat(refusalShape(unknownSerial))
                .as("a deactivated device must not be distinguishable from an unknown one either")
                .isEqualTo(refusalShape(deactivated));
    }

    /**
     * The comparable part of a refusal: everything except the trace id, which is per-request by design
     * and whose variation carries no information about the device.
     */
    private static String refusalShape(HttpResponse<String> res) {
        return res.statusCode() + "|" + res.body().replaceAll("\"traceId\"\\s*:\\s*\"[^\"]*\"", "\"traceId\":\"*\"");
    }
}
