package io.restaurantos.auth.integration;

import com.fasterxml.jackson.databind.ObjectMapper;
import io.restaurantos.auth.repository.PasswordResetTokenRepository;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * The SHIPPED default: self-service password reset is off, and says so (D-31).
 *
 * <p>{@code notification-service} is an active Maven module with zero source files, so every email
 * path in this platform is dead. 13-09 resolved the question CONTEXT.md left open by declaring
 * email delivery out of scope for this milestone rather than building a consumer that logs a
 * message and drops it — a fake one is strictly worse than none, because it makes a dead flow look
 * alive. See {@code Docs/known-gaps/notification-delivery.md}.
 *
 * <p>This class carries NO {@code @TestPropertySource}, deliberately. It runs against
 * {@code application.yml} exactly as shipped, so what it measures is the default an operator gets —
 * not a mode a test asked for. {@link PasswordResetHardeningIT} pins {@code outbox} and covers the
 * other side.
 *
 * <p><b>The property that must survive this whole plan.</b> Turning a flow off is the easiest way
 * in the world to build an account-existence oracle: refuse for unknown addresses, accept for known
 * ones, and the endpoint answers a question it was built not to answer. The disabled response is
 * therefore account-INDEPENDENT — it is decided before any tenant is resolved and before any row is
 * read, so it cannot differ, and cannot differ in timing either.
 */
class PasswordResetDeliveryDisabledIT extends BaseIntegrationTest {

    private static final String DISABLED_CODE = "RESET_DELIVERY_DISABLED";

    @Autowired private PasswordResetTokenRepository passwordResetTokenRepository;

    private final ObjectMapper objectMapper = new ObjectMapper();

    @Test
    @DisplayName("disabled mode issues no token, writes no event, and names the supported route")
    void disabledMode_issuesNothingAndSaysSo() throws Exception {
        long tokensBefore = resetTokenCount();
        List<String> eventsBefore = resetEvents();

        ResponseEntity<String> response = requestReset(TestFixtures.CASHIER_EMAIL);

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(resetTokenCount())
            .as("disabled means no token is minted at all, not a token nobody delivers")
            .isEqualTo(tokensBefore);
        assertThat(resetEvents()).isEqualTo(eventsBefore);

        var warnings = objectMapper.readTree(response.getBody()).path("warnings");
        assertThat(warnings).hasSize(1);
        assertThat(warnings.get(0).path("code").asText()).isEqualTo(DISABLED_CODE);
        assertThat(warnings.get(0).path("message").asText())
            .as("a UI has to be able to tell the user what to do instead")
            .containsIgnoringCase("administrator");
    }

    @Test
    @DisplayName("the disabled response is byte-identical for a known and an unknown address")
    void disabledMode_isNotAnAccountExistenceOracle() {
        ResponseEntity<String> known = requestReset(TestFixtures.CASHIER_EMAIL);
        ResponseEntity<String> unknown = requestReset("nobody-" + UUID.randomUUID() + "@demo.local");
        ResponseEntity<String> unknownTenant = requestReset(TestFixtures.CASHIER_EMAIL, "no-such-tenant");

        assertThat(unknown.getBody()).isEqualTo(known.getBody());
        assertThat(unknown.getStatusCode()).isEqualTo(known.getStatusCode());

        // A tenant that does not exist must be indistinguishable too. The disabled branch returns
        // BEFORE the tenant lookup precisely so that this holds without anyone having to remember
        // it — the response cannot depend on a row that is never read.
        assertThat(unknownTenant.getBody()).isEqualTo(known.getBody());
        assertThat(unknownTenant.getStatusCode()).isEqualTo(known.getStatusCode());

        // The control: the code really is present, so the equality above is not three empty bodies
        // matching each other.
        assertThat(known.getBody()).contains(DISABLED_CODE);
    }

    private ResponseEntity<String> requestReset(String email) {
        return requestReset(email, TestFixtures.DEMO_SLUG);
    }

    private ResponseEntity<String> requestReset(String email, String tenantSlug) {
        return exchangePost("/api/v1/auth/reset-password/request",
            Map.of("email", email, "tenantSlug", tenantSlug));
    }

    private long resetTokenCount() {
        setRls(TestFixtures.demoTenantId());
        return passwordResetTokenRepository.findAll().stream()
            .filter(t -> "RESET".equals(t.getPurpose()))
            .count();
    }

    private List<String> resetEvents() {
        List<String> all = new ArrayList<>();
        outboxRepository.findTop200ByStatusOrderByCreatedAtAsc("PENDING").stream()
            .filter(e -> "PASSWORD_RESET_REQUESTED".equals(e.getEventType()))
            .forEach(e -> all.add(e.getEnvelopeJson()));
        outboxRepository.findTop200ByStatusOrderByCreatedAtAsc("SENT").stream()
            .filter(e -> "PASSWORD_RESET_REQUESTED".equals(e.getEventType()))
            .forEach(e -> all.add(e.getEnvelopeJson()));
        return all;
    }
}
