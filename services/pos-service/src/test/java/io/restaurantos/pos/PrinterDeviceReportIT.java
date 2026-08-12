package io.restaurantos.pos;

import io.restaurantos.pos.config.PrintAgentCredentialFilter;
import io.restaurantos.pos.domain.enums.PrintJobStatus;
import io.restaurantos.pos.domain.model.PrintJob;
import io.restaurantos.pos.repository.PrintJobRepository;
import io.restaurantos.pos.service.PrintAgentEnrolmentService;
import io.restaurantos.pos.service.PrinterDeliveryHealthService;
import io.restaurantos.shared.print.PrintDocument;
import io.restaurantos.shared.tenant.TenantContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

/**
 * S8 — the two facts the printers screen could not get, driven through the real endpoints.
 *
 * <h2>1. What print queues the agent's machine has</h2>
 *
 * <p>Until this, choosing a USB printer meant typing a CUPS destination from memory into a free
 * text box. The agent can see its own queues; the only channel out of a restaurant LAN is the claim
 * poll (there is no route inward — 26-CONTEXT, D-26-06), so the queues ride up on that poll and are
 * stored on the agent's own row.
 *
 * <h2>2. Whether a configured printer is actually printing</h2>
 *
 * <p>An agent reads "Connected" when the MACHINE is polling, and the unrouted-stations alert stays
 * silent when a station HAS a printer. Neither can say that a perfectly configured GRILL printer
 * has refused every connection since lunch, which is the state a kitchen actually meets.
 */
@TestPropertySource(properties = "restaurantos.print.sweep.enabled=false")
class PrinterDeviceReportIT extends PosTestBase {

    @Autowired PrintAgentEnrolmentService enrolmentService;
    @Autowired PrinterDeliveryHealthService healthService;
    @Autowired PrintJobRepository printJobRepository;
    @Autowired TenantContext tenantContext;
    @Autowired WebApplicationContext webApplicationContext;
    @Autowired org.springframework.security.web.FilterChainProxy springSecurityFilterChain;
    @Autowired org.springframework.jdbc.core.JdbcTemplate jdbcTemplate;

    MockMvc mockMvc;
    UUID tenantId;
    UUID branchId;
    String secret;
    UUID agentId;

    @BeforeEach
    void setUp() {
        mockMvc = MockMvcBuilders.webAppContextSetup(webApplicationContext)
                .addFilters(springSecurityFilterChain)
                .build();
        tenantId = UUID.randomUUID();
        branchId = UUID.randomUUID();
        tenantContext.set(tenantId, branchId, UUID.randomUUID(), null);
        PrintAgentEnrolmentService.Enrolled enrolled = enrolmentService.enrol(branchId, "Counter till");
        secret = enrolled.secret();
        agentId = enrolled.agentId();
    }

    private void claimWithBody(String body) throws Exception {
        mockMvc.perform(post(PrintAgentCredentialFilter.CLAIM_PATH)
                        .header("x-print-agent-key", secret)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers.status().isOk());
    }

    private PrintAgentEnrolmentService.AgentView view() {
        tenantContext.set(tenantId, branchId, UUID.randomUUID(), null);
        return enrolmentService.list(branchId).stream()
                .filter(a -> a.agentId().equals(agentId))
                .findFirst()
                .orElseThrow();
    }

    // ══ 1. The device report ═════════════════════════════════════════════════════════════════

    @Test
    @DisplayName("the queues an agent reports on its poll are readable on the printers screen, by name")
    void devicesReportedOnPollAreReadable() throws Exception {
        claimWithBody("""
                {"max":5,"devices":[
                  {"name":"STMicroelectronics_POS80_Printer_USB",
                   "description":"STMicroelectronics POS80 Printer USB","state":"IDLE","isDefault":true},
                  {"name":"_80Series2","description":"80Series2","state":"STOPPED","isDefault":false}
                ],"devicesUnavailable":null}
                """);

        PrintAgentEnrolmentService.AgentView agent = view();
        assertThat(agent.devices()).extracting(PrintAgentEnrolmentService.ReportedDevice::name)
                .containsExactly("STMicroelectronics_POS80_Printer_USB", "_80Series2");
        assertThat(agent.devices().get(0).isDefault()).isTrue();
        assertThat(agent.devices().get(1).state()).isEqualTo("STOPPED");
        assertThat(agent.devicesUnavailable()).isNull();
        assertThat(agent.devicesReportedAt()).isNotNull();
        assertThat(agent.lastSeenAt()).isNotNull();
    }

    @Test
    @DisplayName("an agent that says nothing about devices does not blank the list it reported before")
    void silenceDoesNotBlankTheStoredList() throws Exception {
        claimWithBody("""
                {"max":5,"devices":[{"name":"TILL_USB","description":null,"state":"IDLE","isDefault":false}]}
                """);
        assertThat(view().devices()).hasSize(1);

        // An older agent, or one whose first scan has not finished. Silence is not "no printers".
        claimWithBody("{\"max\":5}");

        assertThat(view().devices())
                .as("a deploy of an older agent must not empty a manager's printer picker")
                .hasSize(1);
    }

    @Test
    @DisplayName("a machine that could not be scanned reports a REASON, distinct from having none")
    void anUnscannableMachineReportsWhy() throws Exception {
        claimWithBody("""
                {"max":5,"devices":[],"devicesUnavailable":"No CUPS installation was found on this machine."}
                """);

        PrintAgentEnrolmentService.AgentView agent = view();
        assertThat(agent.devices()).isEmpty();
        assertThat(agent.devicesUnavailable()).contains("No CUPS");
    }

    @Test
    @DisplayName("the server caps the reported list, because a cap the client enforces is not a cap")
    void theServerCapsWhatAnAgentCanReport() throws Exception {
        StringBuilder body = new StringBuilder("{\"max\":5,\"devices\":[");
        for (int i = 0; i < 80; i++) {
            if (i > 0) body.append(',');
            body.append("{\"name\":\"queue-").append(i).append("\",\"state\":\"IDLE\",\"isDefault\":false}");
        }
        body.append("]}");
        claimWithBody(body.toString());

        assertThat(view().devices())
                .as("50 is the ceiling; an agent host is not a trusted writer of a tenant's row")
                .hasSize(50);
    }

    @Test
    @DisplayName("a nameless device is dropped rather than stored as an unselectable blank")
    void namelessDevicesAreDropped() throws Exception {
        claimWithBody("""
                {"max":5,"devices":[
                  {"name":"  ","state":"IDLE","isDefault":false},
                  {"name":"REAL_QUEUE","state":"IDLE","isDefault":false}
                ]}
                """);

        assertThat(view().devices()).extracting(PrintAgentEnrolmentService.ReportedDevice::name)
                .containsExactly("REAL_QUEUE");
    }

    // ══ 2. Delivery health ═══════════════════════════════════════════════════════════════════

    @Test
    @DisplayName("a printer whose latest job FAILED is reported as unable to print, with the transport's error")
    void aFailingPrinterIsReportedFailing() {
        job("grill-9102", PrintJobStatus.DEAD_LETTERED, 5, "connect ECONNREFUSED 127.0.0.1:9102");
        job("till-receipt", PrintJobStatus.PRINTED, 0, null);

        PrinterDeliveryHealthService.BranchPrintHealth health = healthService.forBranch(branchId);

        PrinterDeliveryHealthService.PrinterDelivery grill = find(health, "grill-9102");
        assertThat(grill.state()).isEqualTo(PrinterDeliveryHealthService.State.FAILING);
        assertThat(grill.lastError()).isEqualTo("connect ECONNREFUSED 127.0.0.1:9102");
        assertThat(grill.failed()).isEqualTo(1);

        PrinterDeliveryHealthService.PrinterDelivery till = find(health, "till-receipt");
        assertThat(till.state()).isEqualTo(PrinterDeliveryHealthService.State.PRINTING);
        assertThat(till.lastError())
                .as("a printer whose latest job succeeded must not display the error before it")
                .isNull();
    }

    @Test
    @DisplayName("a printer RETRYING after a refused connection is failing, not waiting")
    void aRetryingPrinterIsFailingNotWaiting() {
        // This is what a dead printer actually looks like for the first several minutes:
        // `acknowledge(FAILED)` puts the row BACK to QUEUED with attempts+1 and the transport's
        // error on it, and DEAD_LETTERED only arrives on the fifth attempt. A rule that read the
        // status alone would report this as "waiting" for the whole window a kitchen notices.
        job("grill-9102", PrintJobStatus.QUEUED, 2, "connect ECONNREFUSED 127.0.0.1:9102");

        PrinterDeliveryHealthService.PrinterDelivery grill =
                find(healthService.forBranch(branchId), "grill-9102");
        assertThat(grill.state()).isEqualTo(PrinterDeliveryHealthService.State.FAILING);
        assertThat(grill.lastError()).isEqualTo("connect ECONNREFUSED 127.0.0.1:9102");
        assertThat(grill.waiting()).isEqualTo(1);
        assertThat(grill.failed()).isEqualTo(1);
    }

    @Test
    @DisplayName("a job that has never been attempted is WAITING, and accuses nobody")
    void anUnattemptedJobIsWaiting() {
        job("grill-9102", PrintJobStatus.QUEUED, 0, null);

        PrinterDeliveryHealthService.PrinterDelivery grill =
                find(healthService.forBranch(branchId), "grill-9102");
        assertThat(grill.state()).isEqualTo(PrinterDeliveryHealthService.State.WAITING);
        assertThat(grill.lastError()).isNull();
        assertThat(grill.failed()).isZero();
    }

    @Test
    @DisplayName("the MOST RECENT outcome decides, so a fixed printer stops being accused")
    void theMostRecentOutcomeDecides() {
        PrintJob failed = job("grill-9102", PrintJobStatus.DEAD_LETTERED, 5, "connect ECONNREFUSED");
        PrintJob printed = job("grill-9102", PrintJobStatus.PRINTED, 0, null);
        // Stamped explicitly rather than trusted to insertion order: the rule under test IS
        // recency, and a test that passed because two rows happened to be written in order would
        // pass for a reason that is not the rule.
        touch(failed, Instant.now().minusSeconds(600));
        touch(printed, Instant.now().minusSeconds(30));

        PrinterDeliveryHealthService.PrinterDelivery grill = find(healthService.forBranch(branchId), "grill-9102");
        assertThat(grill.state()).isEqualTo(PrinterDeliveryHealthService.State.PRINTING);
        assertThat(grill.failed()).isEqualTo(1);
        assertThat(grill.printed()).isEqualTo(1);
    }

    @Test
    @DisplayName("an ISSUED row is not reported as waiting — no agent will ever claim it")
    void issuedRowsAreNotWaiting() {
        job(PrintJob.UNASSIGNED_TARGET, PrintJobStatus.ISSUED, 0, null);

        assertThat(healthService.forBranch(branchId).printers())
                .as("an unrouted browser bill is not a queue anybody is going to drain")
                .isEmpty();
    }

    @Test
    @DisplayName("another branch's failures are invisible here")
    void anotherBranchIsInvisible() {
        UUID otherBranch = UUID.randomUUID();
        PrintJob other = job("grill-9102", PrintJobStatus.DEAD_LETTERED, 5, "not this branch's problem");
        other.setBranchId(otherBranch);
        printJobRepository.saveAndFlush(other);

        assertThat(healthService.forBranch(branchId).printers()).isEmpty();
    }

    private static PrinterDeliveryHealthService.PrinterDelivery find(
            PrinterDeliveryHealthService.BranchPrintHealth health, String printerId) {
        return health.printers().stream()
                .filter(p -> p.printerId().equals(printerId))
                .findFirst()
                .orElseThrow(() -> new AssertionError("no health row for " + printerId
                        + " — rows: " + health.printers()));
    }

    private PrintJob job(String target, PrintJobStatus status, int attempts, String lastError) {
        PrintJob job = new PrintJob();
        job.setTenantId(tenantId);
        job.setBranchId(branchId);
        job.setOrderId(UUID.randomUUID());
        job.setDocumentType(PrintDocument.DocumentType.KITCHEN_TICKET);
        job.setTargetPrinterId(target);
        job.setIssueSeq(1);
        job.setRevisionNo(1);
        job.setStatus(status);
        job.setAttempts(attempts);
        job.setLastError(lastError);
        job.setDocument("{\"schemaVersion\":\"1.0\",\"type\":\"KITCHEN_TICKET\"}");
        job.setIssuedAt(Instant.now());
        return printJobRepository.saveAndFlush(job);
    }

    /**
     * Force one row's {@code updated_at}, so recency is asserted rather than assumed.
     *
     * <p>Native, because the column is {@code @LastModifiedDate} — Spring Data auditing overwrites
     * anything a setter puts there on the next flush, which would make this helper silently do
     * nothing and the test pass on ordering instead of on the rule.
     */
    private void touch(PrintJob job, Instant at) {
        jdbcTemplate.update("UPDATE print_jobs SET updated_at = ? WHERE id = ?",
                java.sql.Timestamp.from(at), job.getId());
    }
}
