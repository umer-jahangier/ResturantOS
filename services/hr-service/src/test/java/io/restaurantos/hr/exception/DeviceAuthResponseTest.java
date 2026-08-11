package io.restaurantos.hr.exception;

import io.restaurantos.hr.adms.DeviceAuthException;
import io.restaurantos.shared.api.GlobalExceptionHandler;
import org.junit.jupiter.api.Test;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Pins the wire contract of a refused biometric terminal — the advice arrangement half.
 *
 * <p><b>Both advices are registered here, in the same arrangement the running service has</b> (the
 * shared one is contributed by {@code SharedAutoConfiguration}). That is the whole point. The shared
 * advice ends in {@code @ExceptionHandler(Exception.class)}, {@code ExceptionHandlerExceptionResolver}
 * picks the first advice bean that can handle an exception rather than the most specific signature
 * across beans, and with only the shared advice in place every device-authentication failure in this
 * product's history was answered {@code 500 INTERNAL_ERROR} — the {@code @ResponseStatus(UNAUTHORIZED)}
 * on {@link DeviceAuthException} never ran. A test that registered only the local advice would pass
 * against a service that still answered 500.
 *
 * <p>This is the identical defect {@link TotpRequiredResponseTest} was written to pin, on a second
 * exception in the same service. Two occurrences is what makes it a class of bug rather than a typo,
 * and is the argument for {@link HrExceptionHandler} existing at all rather than another annotation.
 *
 * <p>Why the status matters more here than a wrong status usually does: an ADMS terminal polls every
 * three to eight seconds, forever. An unknown serial produced an unhandled-exception stack trace at
 * that cadence — a log flood that buries real failures and fills a disk — and a device that could
 * never learn it was unauthorised, because 500 reads as "the server is broken, retry" while 401 reads
 * as "you are not enrolled".
 *
 * <p>This test proves the <em>advice arrangement</em>. Only a real request proves what a device
 * receives, and that is {@code DeviceAuthHttpIT}.
 */
class DeviceAuthResponseTest {

    /** Stands in for {@code AdmsController}: one exception type, four causes, one answer. */
    @RestController
    static class DeviceController {
        @GetMapping("/iclock/cdata")
        public String cdata(@RequestParam("cause") String cause) {
            throw new DeviceAuthException(switch (cause) {
                case "unknown" -> "Unknown device serial";
                case "inactive" -> "Device is inactive";
                case "archived" -> "Device is archived";
                default -> "Invalid device token";
            });
        }
    }

    private final MockMvc mvc = MockMvcBuilders.standaloneSetup(new DeviceController())
            .setControllerAdvice(new HrExceptionHandler(), new GlobalExceptionHandler())
            .build();

    @Test
    void aRefusedDeviceIsA401WithAStableMachineReadableCode() throws Exception {
        mvc.perform(get("/iclock/cdata").param("cause", "badtoken"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.error.code").value("DEVICE_AUTH_FAILED"));
    }

    /**
     * Asserted as its own case, deliberately. The entire defect was that a specific status was masked
     * by a general one, so "is 401" and "is not 500" are two different claims and the second is the
     * one that regressed.
     */
    @Test
    void aRefusedDeviceIsNotA500SoItIsNotMistakenForTheServerBeingBroken() throws Exception {
        int status = mvc.perform(get("/iclock/cdata").param("cause", "badtoken"))
                .andReturn().getResponse().getStatus();

        assertThat(status).isNotEqualTo(500);
    }

    /**
     * Four causes, one answer — compared to each other rather than each to a literal.
     *
     * <p>Comparing each response to an expected string lets four responses each satisfy a written
     * expectation while still differing from one another. Comparing them to each other is the only
     * form of the assertion that cannot drift.
     *
     * <p>Why it matters: serials are globally unique and {@code resolve_device} is a lookup by serial
     * alone. An endpoint that answers "no such device" differently from "that device exists, wrong
     * token" is a serial-number oracle, and a serial is the first half of the credential in every
     * mode this phase adds.
     */
    @Test
    void everyCauseProducesAByteIdenticalRefusal() throws Exception {
        List<String> bodies = List.of("unknown", "inactive", "archived", "badtoken").stream()
                .map(this::refusalBody)
                .toList();

        assertThat(bodies)
                .as("an unknown serial, an inactive device, an archived device and a wrong token "
                        + "must be indistinguishable to the caller")
                .containsOnly(bodies.get(0));
    }

    @Test
    void theRefusalLeaksNoSerialNoTokenAndNoCause() throws Exception {
        String body = refusalBody("unknown");

        assertThat(body)
                .doesNotContain("serial")
                .doesNotContain("Unknown")
                .doesNotContain("inactive")
                .doesNotContain("token")
                .doesNotContain("Invalid");
    }

    private String refusalBody(String cause) {
        try {
            return mvc.perform(get("/iclock/cdata").param("cause", cause))
                    .andReturn().getResponse().getContentAsString();
        } catch (Exception e) {
            throw new AssertionError("refusal request failed for cause=" + cause, e);
        }
    }
}
