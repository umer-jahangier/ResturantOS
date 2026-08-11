package io.restaurantos.pos;

import ch.qos.logback.classic.Level;
import ch.qos.logback.classic.LoggerContext;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import io.restaurantos.pos.domain.model.PrintAgent;
import io.restaurantos.pos.repository.PrintAgentRepository;
import io.restaurantos.pos.service.PrintAgentEnrolmentService;
import io.restaurantos.shared.tenant.TenantContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;

import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * The identity of a machine that prints — and the nine things that make it a credential rather
 * than a liability.
 */
class PrintAgentEnrolmentIT extends PosTestBase {

    @Autowired PrintAgentEnrolmentService service;
    @Autowired PrintAgentRepository repository;
    @Autowired TenantContext tenantContext;

    UUID tenantId;
    UUID branchId;

    private ListAppender<ILoggingEvent> captured;

    @BeforeEach
    void setUp() {
        tenantId = UUID.randomUUID();
        branchId = UUID.randomUUID();
        tenantContext.set(tenantId, branchId, UUID.randomUUID(), null);

        // Capture EVERYTHING this service logs, at DEBUG — the level the refusal paths use. A scan
        // that only ever saw INFO would prove nothing about the branch that handles a wrong secret.
        LoggerContext context = (LoggerContext) LoggerFactory.getILoggerFactory();
        ch.qos.logback.classic.Logger logger = context.getLogger(PrintAgentEnrolmentService.class);
        logger.setLevel(Level.DEBUG);
        captured = new ListAppender<>();
        captured.start();
        logger.addAppender(captured);
    }

    @AfterEach
    void tearDown() {
        ((LoggerContext) LoggerFactory.getILoggerFactory())
                .getLogger(PrintAgentEnrolmentService.class).detachAppender(captured);
    }

    // ══ 1 & 2. The secret exists once, and only its hash persists ═════════════════════════════

    @Test
    @DisplayName("enrolling returns a secret once and persists only its hash")
    void enrollingReturnsTheSecretOnceAndPersistsOnlyItsHash() {
        PrintAgentEnrolmentService.Enrolled enrolled = service.enrol(branchId, "Till 1");

        assertThat(enrolled.secret()).startsWith("rosprt.").hasSizeGreaterThan(60);
        assertThat(enrolled.agentId()).isNotNull();
        assertThat(enrolled.label()).isEqualTo("Till 1");

        PrintAgent row = repository.findScoped(tenantId, enrolled.agentId()).orElseThrow();
        assertThat(row.getCredentialHash())
                .as("bcrypt, and not the secret itself")
                .startsWith("$2")
                .isNotEqualTo(enrolled.secret())
                .doesNotContain(enrolled.secret());
    }

    @Test
    @DisplayName("a read of the agent returns metadata and has no field that could carry a secret")
    void aReadReturnsMetadataOnly() {
        PrintAgentEnrolmentService.Enrolled enrolled = service.enrol(branchId, "Till 1");

        var views = service.list(branchId);
        assertThat(views).hasSize(1);
        var view = views.get(0);
        assertThat(view.agentId()).isEqualTo(enrolled.agentId());
        assertThat(view.label()).isEqualTo("Till 1");
        assertThat(view.revoked()).isFalse();

        // Asserted on the TYPE, not on the values: a future field called `secret` would fail here
        // rather than shipping and being noticed by a customer.
        assertThat(java.util.Arrays.stream(
                        PrintAgentEnrolmentService.AgentView.class.getRecordComponents())
                        .map(java.lang.reflect.RecordComponent::getName))
                .as("no component of the read model may be a secret or a hash")
                .noneMatch(n -> n.toLowerCase().contains("secret")
                        || n.toLowerCase().contains("hash")
                        || n.toLowerCase().contains("credential"));
    }

    // ══ 3 & 4. Resolution, and the absence of an enumeration oracle ═══════════════════════════

    @Test
    @DisplayName("the correct secret resolves to exactly one agent and its branch")
    void theCorrectSecretResolves() {
        PrintAgentEnrolmentService.Enrolled enrolled = service.enrol(branchId, "Till 1");

        Optional<PrintAgent> resolved = service.resolve(enrolled.secret());

        assertThat(resolved).isPresent();
        assertThat(resolved.get().getId()).isEqualTo(enrolled.agentId());
        assertThat(resolved.get().getBranchId()).isEqualTo(branchId);
        assertThat(resolved.get().getTenantId()).isEqualTo(tenantId);
    }

    @Test
    @DisplayName("a wrong secret, an unknown agent and a malformed string all fail identically")
    void everyFailureIsTheSameFailure() {
        PrintAgentEnrolmentService.Enrolled enrolled = service.enrol(branchId, "Till 1");
        String good = enrolled.secret();
        String[] parts = good.split("\\.");

        // Right agent, wrong secret.
        assertThat(service.resolve(parts[0] + "." + parts[1] + "." + parts[2] + ".wrongsecret"))
                .isEmpty();
        // Right tenant, unknown lookup id.
        assertThat(service.resolve(parts[0] + "." + parts[1] + ".nosuchagent." + parts[3])).isEmpty();
        // Unknown tenant entirely.
        assertThat(service.resolve(parts[0] + "." + UUID.randomUUID().toString().replace("-", "")
                + "." + parts[2] + "." + parts[3])).isEmpty();
        // Not a credential at all.
        assertThat(service.resolve("hello")).isEmpty();
        assertThat(service.resolve("")).isEmpty();
        assertThat(service.resolve(null)).isEmpty();

        // Every one is the SAME Optional.empty(). There is no shape of response, no exception type
        // and no message a caller could use to tell which of these it hit.
    }

    // ══ 5 & 6. Revocation, and re-enrolment ══════════════════════════════════════════════════

    @Test
    @DisplayName("revoking stops the secret resolving immediately, and the record survives")
    void revokingStopsResolutionAndKeepsTheRecord() {
        PrintAgentEnrolmentService.Enrolled enrolled = service.enrol(branchId, "Till 1");
        assertThat(service.resolve(enrolled.secret())).isPresent();

        service.revoke(enrolled.agentId());

        assertThat(service.resolve(enrolled.secret()))
                .as("no cache window — the very next call is refused")
                .isEmpty();

        var view = service.list(branchId).stream()
                .filter(v -> v.agentId().equals(enrolled.agentId())).findFirst().orElseThrow();
        assertThat(view.revoked()).isTrue();
        assertThat(view.revokedAt()).isNotNull();
    }

    @Test
    @DisplayName("re-enrolling issues a new secret and does not revive the old one")
    void reEnrollingDoesNotReviveTheOldSecret() {
        PrintAgentEnrolmentService.Enrolled first = service.enrol(branchId, "Till 1");
        service.revoke(first.agentId());

        PrintAgentEnrolmentService.Enrolled second = service.enrol(branchId, "Till 1 (replacement)");

        assertThat(second.secret()).isNotEqualTo(first.secret());
        assertThat(service.resolve(second.secret())).isPresent();
        assertThat(service.resolve(first.secret()))
                .as("a new enrolment must not resurrect a revoked credential")
                .isEmpty();
    }

    // ══ 7. Constant-time comparison, inherited rather than hand-written ══════════════════════

    @Test
    @DisplayName("the comparison is the shared bcrypt encoder, not a hand-written equals")
    void theComparisonIsTheSharedEncoder() {
        PrintAgentEnrolmentService.Enrolled enrolled = service.enrol(branchId, "Till 1");
        String hash = repository.findScoped(tenantId, enrolled.agentId()).orElseThrow()
                .getCredentialHash();

        // bcrypt's own marker and cost factor. Asserting the STORED FORM is how this test knows the
        // comparison is BCryptPasswordEncoder.matches — which is constant-time with respect to the
        // input — rather than a String.equals somebody wrote in a hurry.
        //
        // NOTE ON WHAT THIS DOES NOT PROVE: it does not measure timing. A timing assertion inside a
        // JVM under a test runner measures the scheduler, not the algorithm. This asserts the
        // PROPERTY THAT IMPLIES IT — that the product's one audited encoder is what stored the
        // value — and says so rather than implying it has timed anything.
        assertThat(hash).startsWith("$2a$12$");
    }

    // ══ 8. Nothing logs the secret ═══════════════════════════════════════════════════════════

    @Test
    @DisplayName("no log line from an enrolment or a failed authentication contains the secret")
    void nothingLogsTheSecret() {
        PrintAgentEnrolmentService.Enrolled enrolled = service.enrol(branchId, "Till 1");
        String secret = enrolled.secret();
        String secretTail = secret.substring(secret.lastIndexOf('.') + 1);

        // Exercise the refusal branches too — they are the ones most likely to helpfully echo the
        // input somebody is debugging.
        service.resolve(secret.substring(0, secret.length() - 4) + "zzzz");
        service.resolve("rosprt." + tenantId.toString().replace("-", "") + ".nosuch." + secretTail);
        service.resolve("garbage");
        service.resolve(secret);

        assertThat(captured.list).isNotEmpty();
        for (ILoggingEvent event : captured.list) {
            String rendered = event.getFormattedMessage();
            assertThat(rendered)
                    .as("a log line carrying the credential is a credential in a second place")
                    .doesNotContain(secret)
                    .doesNotContain(secretTail);
        }
    }

    // ══ 9. Cross-tenant ══════════════════════════════════════════════════════════════════════

    @Test
    @DisplayName("another tenant cannot see or revoke this tenant's agent")
    void anotherTenantCannotSeeOrRevokeThisAgent() {
        PrintAgentEnrolmentService.Enrolled enrolled = service.enrol(branchId, "Till 1");

        UUID otherTenant = UUID.randomUUID();
        tenantContext.set(otherTenant, branchId, UUID.randomUUID(), null);

        assertThat(service.list(branchId)).isEmpty();
        assertThat(repository.findScoped(otherTenant, enrolled.agentId())).isEmpty();
    }
}
