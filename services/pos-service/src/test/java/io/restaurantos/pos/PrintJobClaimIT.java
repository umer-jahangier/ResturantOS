package io.restaurantos.pos;

import ch.qos.logback.classic.Level;
import ch.qos.logback.classic.LoggerContext;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import io.restaurantos.pos.config.PrintAgentCredentialFilter;
import io.restaurantos.pos.domain.enums.PrintJobStatus;
import io.restaurantos.pos.domain.model.PrintAgent;
import io.restaurantos.pos.domain.model.PrintJob;
import io.restaurantos.pos.repository.PrintJobRepository;
import io.restaurantos.pos.service.PrintAgentEnrolmentService;
import io.restaurantos.pos.service.PrintJobClaimService;
import io.restaurantos.shared.print.PrintDocument;
import io.restaurantos.shared.tenant.TenantContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;

import java.time.Clock;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

/**
 * The claim channel: what an agent can take, what it must give back, and — the longer half of this
 * file — everything it cannot touch.
 *
 * <p>The sweep is DISABLED in this context. A background timer racing an assertion about lease
 * expiry produces a test that passes on a fast machine and fails on a busy one; the sweep is
 * exercised by calling it directly with a controlled clock instead.
 */
@TestPropertySource(properties = "restaurantos.print.sweep.enabled=false")
class PrintJobClaimIT extends PosTestBase {

    @Autowired PrintJobClaimService claimService;
    @Autowired PrintAgentEnrolmentService enrolmentService;
    @Autowired PrintJobRepository printJobRepository;
    @Autowired TenantContext tenantContext;
    @Autowired WebApplicationContext webApplicationContext;
    /**
     * The REAL security filter chain, added by hand rather than via spring-security-test's
     * {@code springSecurity()} configurer. That artefact is not on this module's test classpath and
     * this plan adds no dependency to any manifest — and the chain bean is all the configurer wires
     * in anyway, so the shortcut costs nothing and the acceptance criterion stays honest.
     */
    @Autowired org.springframework.security.web.FilterChainProxy springSecurityFilterChain;
    MockMvc mockMvc;

    /** Mocked so lease expiry is asserted by ADVANCING time, never by sleeping through it. */
    @MockitoBean Clock clock;

    UUID tenantId;
    UUID branchId;
    Instant now;
    PrintAgent agent;
    String secret;

    private ListAppender<ILoggingEvent> captured;

    @BeforeEach
    void setUp() {
        // Built from the real web application context so the REAL security filter chain runs —
        // including PrintAgentCredentialFilter, which is the thing under test. A standalone setup
        // would bypass exactly the component this file exists to verify.
        mockMvc = MockMvcBuilders.webAppContextSetup(webApplicationContext)
                .addFilters(springSecurityFilterChain)
                .build();
        tenantId = UUID.randomUUID();
        branchId = UUID.randomUUID();
        now = Instant.parse("2026-08-12T10:00:00Z");
        when(clock.instant()).thenAnswer(i -> now);

        tenantContext.set(tenantId, branchId, UUID.randomUUID(), null);
        PrintAgentEnrolmentService.Enrolled enrolled = enrolmentService.enrol(branchId, "Till 1");
        secret = enrolled.secret();
        agent = resolve(secret);

        LoggerContext context = (LoggerContext) LoggerFactory.getILoggerFactory();
        ch.qos.logback.classic.Logger logger = context.getLogger(PrintAgentCredentialFilter.class);
        logger.setLevel(Level.DEBUG);
        captured = new ListAppender<>();
        captured.start();
        logger.addAppender(captured);
    }

    @AfterEach
    void tearDown() {
        ((LoggerContext) LoggerFactory.getILoggerFactory())
                .getLogger(PrintAgentCredentialFilter.class).detachAppender(captured);
    }

    private PrintAgent resolve(String credential) {
        return enrolmentService.resolve(credential).orElseThrow();
    }

    // ══ 1. A claim returns work, with everything needed to print it ═══════════════════════════

    @Test
    @DisplayName("an agent claims its branch's queued jobs, each carrying its document and target")
    void anAgentClaimsItsBranchesQueuedJobs() {
        UUID orderId = UUID.randomUUID();
        queued(tenantId, branchId, orderId, "kitchen-hot", 1);
        queued(tenantId, branchId, orderId, "kitchen-cold", 1);

        PrintJobClaimService.ClaimResult result = claimService.claim(agent, 10);

        assertThat(result.jobs()).hasSize(2);
        assertThat(result.leaseExpiresAt()).isEqualTo(now.plusSeconds(PrintJobClaimService.DEFAULT_LEASE_SECONDS));
        assertThat(result.jobs()).allSatisfy(j -> {
            assertThat(j.document()).contains("KITCHEN_TICKET");
            assertThat(j.documentType()).isEqualTo("KITCHEN_TICKET");
            assertThat(j.targetPrinterId()).startsWith("kitchen-");
        });
    }

    @Test
    @DisplayName("a claim is bounded, so one agent cannot drain a busy branch in one call")
    void aClaimIsBounded() {
        for (int i = 1; i <= 4; i++) {
            queued(tenantId, branchId, UUID.randomUUID(), "kitchen-hot", i);
        }
        assertThat(claimService.claim(agent, 2).jobs()).hasSize(2);
        assertThat(claimService.claim(agent, 100).jobs())
                .as("the remaining two, and the request for 100 is clamped rather than honoured")
                .hasSize(2);
    }

    // ══ 2. The lease holds ═══════════════════════════════════════════════════════════════════

    @Test
    @DisplayName("a claimed job is not handed to a second claim while its lease holds")
    void aClaimedJobIsNotHandedOutTwice() {
        queued(tenantId, branchId, UUID.randomUUID(), "kitchen-hot", 1);

        assertThat(claimService.claim(agent, 10).jobs()).hasSize(1);
        assertThat(claimService.claim(agent, 10).jobs())
                .as("the lease is what stops the same ticket printing twice")
                .isEmpty();

        PrintJob row = onlyJob();
        assertThat(row.getStatus()).isEqualTo(PrintJobStatus.CLAIMED);
        assertThat(row.getClaimedByAgentId()).isEqualTo(agent.getId());
        assertThat(row.getLeaseExpiresAt()).isAfter(now);
    }

    // ══ 3. Acknowledgement ═══════════════════════════════════════════════════════════════════

    @Test
    @DisplayName("acknowledging DELIVERED moves the job to PRINTED and releases the lease")
    void ackDeliveredMovesToPrinted() {
        queued(tenantId, branchId, UUID.randomUUID(), "kitchen-hot", 1);
        UUID jobId = claimService.claim(agent, 1).jobs().get(0).printJobId();

        var outcome = claimService.acknowledge(agent, jobId, PrintJobClaimService.AckResult.DELIVERED, null);

        assertThat(outcome.applied()).isTrue();
        assertThat(outcome.status()).isEqualTo(PrintJobStatus.PRINTED);
        assertThat(onlyJob().getLeaseExpiresAt()).isNull();
    }

    @Test
    @DisplayName("acknowledging FAILED requeues with backoff, and dead-letters at the attempt limit")
    void ackFailedRequeuesThenDeadLetters() {
        queued(tenantId, branchId, UUID.randomUUID(), "kitchen-hot", 1);

        for (int attempt = 1; attempt < PrintJobClaimService.MAX_ATTEMPTS; attempt++) {
            UUID jobId = claimService.claim(agent, 1).jobs().get(0).printJobId();
            var outcome = claimService.acknowledge(agent, jobId,
                    PrintJobClaimService.AckResult.FAILED, "printer refused the connection");
            assertThat(outcome.status()).isEqualTo(PrintJobStatus.QUEUED);

            PrintJob row = onlyJob();
            assertThat(row.getAttempts()).isEqualTo(attempt);
            assertThat(row.getLastError()).contains("printer refused");
            assertThat(row.getNextAttemptAt())
                    .as("backoff — otherwise a poll loop hammers a device that is already unhappy")
                    .isAfter(now);

            // Move past the backoff so the next claim can take it.
            now = row.getNextAttemptAt().plusSeconds(1);
        }

        UUID jobId = claimService.claim(agent, 1).jobs().get(0).printJobId();
        var last = claimService.acknowledge(agent, jobId, PrintJobClaimService.AckResult.FAILED, "still refused");
        assertThat(last.status()).isEqualTo(PrintJobStatus.DEAD_LETTERED);
        assertThat(onlyJob().getAttempts()).isEqualTo(PrintJobClaimService.MAX_ATTEMPTS);
    }

    // ══ 4. An expired lease returns the work, without anyone sleeping ════════════════════════

    /**
     * The switch-off is ASSERTED, not assumed.
     *
     * <p>It was assumed once. The sweep was a nested {@code @Component} whose
     * {@code @ConditionalOnProperty} did not bind, so it kept running, incremented a job's attempt
     * count a second time between two lines of {@link #anExpiredLeaseReturnsTheJob}, and produced a
     * failure that read like a bug in the reclaim rather than a race with a timer.
     */
    @Test
    @DisplayName("the background sweep is genuinely absent from this context")
    void theBackgroundSweepIsAbsent() {
        assertThat(webApplicationContext.getBeanNamesForType(
                io.restaurantos.pos.config.PrintJobLeaseSweep.class))
                .as("a timer racing these assertions passes on a fast machine and fails on a busy one")
                .isEmpty();
    }

    @Test
    @DisplayName("a lease that expires without an acknowledgement returns the job to the queue")
    void anExpiredLeaseReturnsTheJob() {
        queued(tenantId, branchId, UUID.randomUUID(), "kitchen-hot", 1);
        claimService.claim(agent, 1);
        assertThat(onlyJob().getStatus()).isEqualTo(PrintJobStatus.CLAIMED);

        // The till lost power. Advance past the lease; nobody sleeps.
        now = now.plus(PrintJobClaimService.DEFAULT_LEASE_SECONDS + 1, ChronoUnit.SECONDS);

        // At LEAST one, not exactly one. The sweep is deliberately tenant-wide (it runs on a timer
        // with no request and therefore no tenant context), so a sibling test's leftover claim in
        // this shared database expires on the same advanced clock and is reclaimed too. Asserting
        // an exact global count would be asserting the rest of this file's execution order.
        assertThat(claimService.reclaimExpiredLeases()).isGreaterThanOrEqualTo(1);

        PrintJob row = onlyJob();
        assertThat(row.getStatus()).isEqualTo(PrintJobStatus.QUEUED);
        assertThat(row.getAttempts()).isEqualTo(1);
        assertThat(row.getClaimedByAgentId()).isNull();
        assertThat(row.getLastError()).contains("LEASE_EXPIRED");
        assertThat(claimService.claim(agent, 1).jobs())
                .as("and it is claimable again — a dead agent must not strand a ticket")
                .hasSize(1);
    }

    /**
     * The double-print mitigation. Not that the window does not exist — that when the server has
     * already reclaimed, a late acknowledgement cannot overwrite the reclaim.
     */
    @Test
    @DisplayName("a late acknowledgement after a reclaim is a NO-OP, not a status overwrite")
    void aLateAcknowledgementIsANoOp() {
        queued(tenantId, branchId, UUID.randomUUID(), "kitchen-hot", 1);
        UUID jobId = claimService.claim(agent, 1).jobs().get(0).printJobId();

        now = now.plus(PrintJobClaimService.DEFAULT_LEASE_SECONDS + 1, ChronoUnit.SECONDS);
        claimService.reclaimExpiredLeases();

        var outcome = claimService.acknowledge(agent, jobId,
                PrintJobClaimService.AckResult.DELIVERED, null);

        assertThat(outcome.applied())
                .as("the server's reclaim is authoritative; a late ack must not mark PRINTED a job "
                        + "a sibling agent may be printing right now")
                .isFalse();
        assertThat(onlyJob().getStatus()).isEqualTo(PrintJobStatus.QUEUED);
    }

    // ══ 5. Cross-branch and cross-tenant ═════════════════════════════════════════════════════

    @Test
    @DisplayName("an agent cannot claim, acknowledge or observe another branch's job")
    void anAgentCannotTouchAnotherBranchesJob() {
        UUID otherBranch = UUID.randomUUID();
        PrintJob foreign = queued(tenantId, otherBranch, UUID.randomUUID(), "kitchen-hot", 1);

        assertThat(claimService.claim(agent, 10).jobs())
                .as("same tenant, different branch — still not this agent's work")
                .isEmpty();
        assertThat(claimService.acknowledge(agent, foreign.getId(),
                PrintJobClaimService.AckResult.DELIVERED, null).applied()).isFalse();
        assertThat(byId(foreign.getId()).getStatus()).isEqualTo(PrintJobStatus.QUEUED);
    }

    /**
     * The branch check in {@code acknowledge}, made load-bearing.
     *
     * <p>Written after a sabotage survived: deleting that check left the suite green, because every
     * foreign job in the other test is {@code QUEUED} and the {@code stillOurs} guard rejects it
     * for a different reason. So the check was covered only by accident. This constructs the one
     * state where it is the ONLY thing standing in the way — a job in another branch, already
     * CLAIMED, carrying this agent's id and a live lease — and asserts the ack is still refused.
     */
    @Test
    @DisplayName("an agent cannot acknowledge a CLAIMED job in another branch even if it names this agent")
    void anAgentCannotAcknowledgeAClaimedJobInAnotherBranch() {
        UUID otherBranch = UUID.randomUUID();
        PrintJob foreign = queued(tenantId, otherBranch, UUID.randomUUID(), "kitchen-hot", 1);
        foreign.setStatus(PrintJobStatus.CLAIMED);
        foreign.setClaimedByAgentId(agent.getId());
        foreign.setLeaseExpiresAt(now.plusSeconds(600));
        printJobRepository.saveAndFlush(foreign);

        var outcome = claimService.acknowledge(agent, foreign.getId(),
                PrintJobClaimService.AckResult.DELIVERED, null);

        assertThat(outcome.applied())
                .as("the branch on the agent ROW is the boundary, and it is the only guard here")
                .isFalse();
        assertThat(byId(foreign.getId()).getStatus()).isEqualTo(PrintJobStatus.CLAIMED);
    }

    @Test
    @DisplayName("an agent cannot claim, acknowledge or observe another tenant's job")
    void anAgentCannotTouchAnotherTenantsJob() {
        UUID otherTenant = UUID.randomUUID();
        tenantContext.set(otherTenant, branchId, UUID.randomUUID(), null);
        PrintJob foreign = queued(otherTenant, branchId, UUID.randomUUID(), "kitchen-hot", 1);
        tenantContext.set(tenantId, branchId, UUID.randomUUID(), null);

        assertThat(claimService.claim(agent, 10).jobs())
                .as("same branch id, different tenant — the predicate names both")
                .isEmpty();
        assertThat(claimService.acknowledge(agent, foreign.getId(),
                PrintJobClaimService.AckResult.DELIVERED, null).applied()).isFalse();
    }

    // ══ 6. The credential reaches exactly two endpoints ══════════════════════════════════════

    @Test
    @DisplayName("the agent credential is rejected by every other endpoint in the service")
    void theCredentialCannotReachAnyOtherEndpoint() throws Exception {
        // The endpoints it CAN reach.
        mockMvc.perform(post(PrintAgentCredentialFilter.CLAIM_PATH)
                        .header(PrintAgentCredentialFilter.HEADER, secret)
                        .contentType(MediaType.APPLICATION_JSON).content("{\"max\":5}"))
                .andExpect(r -> assertThat(r.getResponse().getStatus()).isEqualTo(200));

        // And the ones it cannot. An order endpoint requires a pos.* permission that this
        // credential does not and cannot carry — refused by ordinary method security, not by a
        // special case somebody has to remember to add.
        mockMvc.perform(get("/api/v1/pos/orders/" + UUID.randomUUID() + "?branchId=" + branchId)
                        .header(PrintAgentCredentialFilter.HEADER, secret))
                .andExpect(r -> assertThat(r.getResponse().getStatus())
                        .as("an agent must not be able to read an order")
                        .isIn(401, 403));

        mockMvc.perform(post("/api/v1/pos/orders")
                        .header(PrintAgentCredentialFilter.HEADER, secret)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"branchId\":\"" + branchId + "\",\"coverCount\":1}"))
                .andExpect(r -> assertThat(r.getResponse().getStatus()).isIn(401, 403));
    }

    // ══ 7. A missing or invalid credential ═══════════════════════════════════════════════════

    @Test
    @DisplayName("a missing or invalid credential is refused, and nothing credential-shaped is logged")
    void aMissingOrInvalidCredentialIsRefusedWithoutLeakingIt() throws Exception {
        mockMvc.perform(post(PrintAgentCredentialFilter.CLAIM_PATH)
                        .contentType(MediaType.APPLICATION_JSON).content("{}"))
                .andExpect(r -> assertThat(r.getResponse().getStatus()).isIn(401, 403));

        String wrong = secret.substring(0, secret.length() - 4) + "zzzz";
        mockMvc.perform(post(PrintAgentCredentialFilter.CLAIM_PATH)
                        .header(PrintAgentCredentialFilter.HEADER, wrong)
                        .contentType(MediaType.APPLICATION_JSON).content("{}"))
                .andExpect(r -> assertThat(r.getResponse().getStatus()).isIn(401, 403));

        assertThat(captured.list).isNotEmpty();
        for (ILoggingEvent event : captured.list) {
            assertThat(event.getFormattedMessage())
                    .doesNotContain(secret)
                    .doesNotContain(wrong)
                    .doesNotContain(secret.substring(secret.lastIndexOf('.') + 1));
        }
    }

    // ══ 8. Revocation, with no cache window ══════════════════════════════════════════════════

    @Test
    @DisplayName("a revoked credential is refused from the very next request")
    void aRevokedCredentialIsRefusedImmediately() throws Exception {
        mockMvc.perform(post(PrintAgentCredentialFilter.CLAIM_PATH)
                        .header(PrintAgentCredentialFilter.HEADER, secret)
                        .contentType(MediaType.APPLICATION_JSON).content("{}"))
                .andExpect(r -> assertThat(r.getResponse().getStatus()).isEqualTo(200));

        tenantContext.set(tenantId, branchId, UUID.randomUUID(), null);
        enrolmentService.revoke(agent.getId());

        mockMvc.perform(post(PrintAgentCredentialFilter.CLAIM_PATH)
                        .header(PrintAgentCredentialFilter.HEADER, secret)
                        .contentType(MediaType.APPLICATION_JSON).content("{}"))
                .andExpect(r -> assertThat(r.getResponse().getStatus())
                        .as("no cache — the credential is re-read from the row on every request")
                        .isIn(401, 403));
    }

    // ══ 9. Nothing to do is not an error ═════════════════════════════════════════════════════

    @Test
    @DisplayName("claiming with nothing queued returns an explicitly empty result, not an error")
    void anEmptyClaimIsExplicitlyEmpty() throws Exception {
        PrintJobClaimService.ClaimResult result = claimService.claim(agent, 10);
        assertThat(result.jobs()).isEmpty();
        assertThat(result.leaseExpiresAt()).isNull();

        // And over HTTP: a 200 with an empty list. Under forced RLS a wiring break ALSO produces no
        // rows, so "nothing queued" and "wired wrong" must not be the same response shape — this is
        // the 200-with-a-list that lets the agent tell them apart from a 4xx/5xx.
        mockMvc.perform(post(PrintAgentCredentialFilter.CLAIM_PATH)
                        .header(PrintAgentCredentialFilter.HEADER, secret)
                        .contentType(MediaType.APPLICATION_JSON).content("{}"))
                .andExpect(r -> {
                    assertThat(r.getResponse().getStatus()).isEqualTo(200);
                    assertThat(r.getResponse().getContentAsString()).contains("\"jobs\":[]");
                });
    }

    // ── Helpers ──────────────────────────────────────────────────────────────────────────────

    private PrintJob queued(UUID tenant, UUID branch, UUID orderId, String target, int revision) {
        PrintJob job = new PrintJob();
        job.setTenantId(tenant);
        job.setBranchId(branch);
        job.setOrderId(orderId);
        job.setDocumentType(PrintDocument.DocumentType.KITCHEN_TICKET);
        job.setTargetPrinterId(target);
        job.setIssueSeq(1);
        job.setRevisionNo(revision);
        job.setStatus(PrintJobStatus.QUEUED);
        job.setDocument("{\"schemaVersion\":\"1.0\",\"type\":\"KITCHEN_TICKET\"}");
        job.setIssuedAt(now);
        return printJobRepository.saveAndFlush(job);
    }

    private PrintJob onlyJob() {
        List<PrintJob> all = printJobRepository.findAll().stream()
                .filter(j -> tenantId.equals(j.getTenantId()) && branchId.equals(j.getBranchId()))
                .toList();
        assertThat(all).hasSize(1);
        return all.get(0);
    }

    private PrintJob byId(UUID id) {
        return printJobRepository.findById(id).orElseThrow();
    }
}
