package io.restaurantos.hr.exception;

import io.restaurantos.shared.api.GlobalExceptionHandler;
import org.junit.jupiter.api.Test;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RestController;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Pins the wire contract of the payroll-approval step-up gate, because the web client branches on
 * it: on {@code TOTP_REQUIRED} it prompts the user to re-authenticate with a code instead of
 * showing a generic failure.
 *
 * <p>Both advices are registered here, in the same arrangement the running service has (the shared
 * one is contributed by {@code SharedAutoConfiguration}). That is the whole point of the test: the
 * shared advice ends in {@code @ExceptionHandler(Exception.class)}, and with only that in place
 * this exception was answered with {@code 500 INTERNAL_ERROR} — the {@code @ResponseStatus} it used
 * to carry never ran. A regression here is invisible from the service layer, which is where the
 * existing {@code PayrollRunIT} coverage stops.
 */
class TotpRequiredResponseTest {

    @RestController
    static class GatedController {
        @PostMapping("/api/v1/hr/payroll-runs/{id}/approve")
        public String approve() {
            throw new TotpRequiredException();
        }
    }

    private final MockMvc mvc = MockMvcBuilders.standaloneSetup(new GatedController())
            .setControllerAdvice(new HrExceptionHandler(), new GlobalExceptionHandler())
            .build();

    @Test
    void missingStepUpIsA403WithTheTotpRequiredCode() throws Exception {
        mvc.perform(post("/api/v1/hr/payroll-runs/{id}/approve", "11111111-1111-1111-1111-111111111111"))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.error.code").value("TOTP_REQUIRED"));
    }

    /**
     * The status matters on its own: 401 would send the web client's refresh-on-401 interceptor
     * after a new access token, and {@code totp_verified} is deliberately not carried across
     * refresh — so the retry would fail identically, having spent a refresh to learn nothing.
     */
    @Test
    void missingStepUpIsNotA401SoTheClientDoesNotTryToRefreshItsWayOut() throws Exception {
        int status = mvc.perform(
                        post("/api/v1/hr/payroll-runs/{id}/approve", "11111111-1111-1111-1111-111111111111"))
                .andReturn().getResponse().getStatus();

        org.assertj.core.api.Assertions.assertThat(status).isNotEqualTo(401);
    }
}
