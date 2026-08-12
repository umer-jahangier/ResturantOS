package io.restaurantos.audit;

import io.restaurantos.audit.controller.AuditQueryController;
import io.restaurantos.audit.dto.AuditEventView;
import io.restaurantos.audit.dto.AuditFacetsView;
import io.restaurantos.audit.entity.AuditEventEntity;
import io.restaurantos.audit.feign.AuthUserDirectoryClient;
import io.restaurantos.shared.api.ApiResponse;
import io.restaurantos.shared.exception.FieldValidationException;
import io.restaurantos.shared.tenant.TenantContext;
import jakarta.persistence.EntityManager;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.utility.DockerImageName;

import java.sql.Connection;
import java.sql.DriverManager;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.Arrays;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;

/**
 * What a person reading the audit log has to be able to do, asserted against a real database.
 *
 * <h2>Why this class exists separately from {@link AuditReadPathIT}</h2>
 *
 * <p>{@code AuditReadPathIT} proves the log can be READ — the privilege, the permission gate, the
 * tenant boundary. It passed for months while the screen it exists to serve was unbuildable, because
 * nothing asserted the four things a reader actually needs and none of which the endpoint had:
 *
 * <ol>
 *   <li><b>A resource-type filter.</b> The 2026-08-12 walkthrough sent {@code ?resourceType=ORDER}
 *       and got 36 non-order rows out of 40, and recorded it as "the read path ignores its own
 *       filter". It did not ignore it: {@code getEvents} declared {@code action}, {@code from},
 *       {@code to}, {@code page}, {@code size} and Spring discards an undeclared query parameter
 *       without a word. The filter had never existed, and no test could have noticed, because a
 *       parameter that is not declared cannot be called wrongly.</li>
 *   <li><b>A total.</b> The response was {@code ApiResponse.ok(list)} — {@code meta} null — so a
 *       pager could not say "of 208" or know when to stop.</li>
 *   <li><b>Names.</b> {@code userId} is a UUID and an auditor needs a person.</li>
 *   <li><b>Days cut where the restaurant is.</b> {@code from}/{@code to} were cut at UTC midnight
 *       for a branch in {@code Asia/Karachi}.</li>
 * </ol>
 *
 * <p>Every test below is written against the state a reader is actually in — a log holding a mix of
 * logins, voids and journal postings, more rows than one page, and events either side of a local
 * midnight — rather than against the one shape that already worked.
 */
@SpringBootTest(
        classes = AuditServiceApplication.class,
        webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT
)
@Testcontainers
@DisplayName("audit read filters, totals, actor names and day boundaries")
class AuditReadFiltersIT {

    private static final String WRITER_USER = "audit_writer";
    private static final String WRITER_PASSWORD = "audit_writer_pass";

    @Container
    static final PostgreSQLContainer<?> POSTGRES =
            new PostgreSQLContainer<>(DockerImageName.parse("postgres:16"))
                    .withDatabaseName("audit_db")
                    .withUsername("audit_admin")
                    .withPassword("test-pass");

    @BeforeAll
    static void createNonSuperuserWriterRole() throws Exception {
        try (Connection conn = DriverManager.getConnection(
                POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword());
             var stmt = conn.createStatement()) {
            stmt.execute("""
                DO $$ BEGIN
                  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '%s') THEN
                    CREATE ROLE %s LOGIN PASSWORD '%s';
                  END IF;
                END $$
                """.formatted(WRITER_USER, WRITER_USER, WRITER_PASSWORD));
            stmt.execute("GRANT USAGE ON SCHEMA public TO " + WRITER_USER);
        }
    }

    @DynamicPropertySource
    static void props(DynamicPropertyRegistry r) {
        r.add("server.address", () -> "127.0.0.1");
        r.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        // The ordinary runtime role, as in production and as in AuditReadPathIT.
        r.add("spring.datasource.username", () -> WRITER_USER);
        r.add("spring.datasource.password", () -> WRITER_PASSWORD);
        r.add("spring.liquibase.url", POSTGRES::getJdbcUrl);
        r.add("spring.liquibase.user", POSTGRES::getUsername);
        r.add("spring.liquibase.password", POSTGRES::getPassword);
        r.add("spring.jpa.hibernate.ddl-auto", () -> "none");
        r.add("eureka.client.enabled", () -> "false");
        r.add("spring.rabbitmq.listener.simple.auto-startup", () -> "false");
        r.add("spring.rabbitmq.host", () -> "localhost");
        r.add("spring.rabbitmq.port", () -> "5672");
        r.add("spring.rabbitmq.username", () -> "guest");
        r.add("spring.rabbitmq.password", () -> "guest");
        r.add("restaurantos.jwks.uri", () -> "http://127.0.0.1:1/.well-known/jwks.json");
        r.add("TESTCONTAINERS_RYUK_DISABLED", () -> "true");
    }

    /**
     * The staff directory, stubbed — deliberately, and only here.
     *
     * <p>What is under test is the WIRING: that the controller collects the distinct actor ids on a
     * page, asks once per id, and puts the answer on the right row. auth-service's own correctness
     * is its own test's job, and standing up a second service to prove a join would test the
     * network. The one thing a stub must not hide is the failure path, which
     * {@link #anUnreachableDirectoryLeavesTheIdAndNeverBlanksTheRow} exercises by making the stub
     * throw.
     */
    @MockitoBean
    private AuthUserDirectoryClient authUserDirectoryClient;

    @Autowired private AuditQueryController controller;
    @Autowired private TenantContext tenantContext;
    @Autowired private EntityManager entityManager;
    @Autowired private PlatformTransactionManager transactionManager;

    private TransactionTemplate tx;
    /** A fresh tenant per test — see {@link #authenticate()} for why, not merely how. */
    private UUID tenant;

    @BeforeEach
    void setUp() {
        tx = new TransactionTemplate(transactionManager);
        tenant = UUID.randomUUID();
        authenticate();
    }

    @AfterEach
    void clear() {
        tenantContext.clear();
        SecurityContextHolder.clearContext();
    }

    // ── the filter the walkthrough could not use ───────────────────────────────

    /**
     * The headline defect. Before F4 this call returned logins, because {@code resourceType} was not
     * a parameter of {@code getEvents} and Spring dropped it silently.
     */
    @Test
    @DisplayName("resourceType=ORDER returns orders and nothing else")
    void resourceTypeFilterExcludesEverythingElse() {
        insert("ORDER_VOIDED", "ORDER", minutesAgo(60));
        insert("ORDER_REFUNDED", "ORDER", minutesAgo(59));
        insert("USER_LOGIN_SUCCEEDED", "USER", minutesAgo(58));
        insert("USER_LOGIN_FAILED", "USER", minutesAgo(57));
        insert("JOURNAL_POSTED", "JOURNAL", minutesAgo(56));

        List<AuditEventView> rows =
                controller.getEvents(null, "ORDER", null, null, null, 0, 200).data();

        assertThat(rows).isNotEmpty();
        assertThat(rows)
                .as("""
                    Every row of a resourceType=ORDER read must be an ORDER. The walkthrough's
                    ?resourceType=ORDER&size=40 answered USER_LOGIN_SUCCEEDED x24,
                    USER_LOGIN_FAILED x8, JOURNAL_POSTED x3 and TILL_CLOSED x1 — 36 of 40 rows that
                    are not orders.
                    """)
                .allSatisfy(row -> assertThat(row.resourceType()).isEqualTo("ORDER"));
        assertThat(rows).map(AuditEventView::action)
                .containsExactlyInAnyOrder("ORDER_VOIDED", "ORDER_REFUNDED");
    }

    @Test
    @DisplayName("action and resourceType narrow together, not one instead of the other")
    void actionAndResourceTypeCombine() {
        insert("ORDER_VOIDED", "ORDER", minutesAgo(55));
        insert("ORDER_REFUNDED", "ORDER", minutesAgo(54));
        insert("USER_LOGIN_SUCCEEDED", "USER", minutesAgo(53));

        List<AuditEventView> rows =
                controller.getEvents("ORDER_VOIDED", "ORDER", null, null, null, 0, 200).data();

        assertThat(rows).map(AuditEventView::action).containsOnly("ORDER_VOIDED");

        // A combination that cannot match must return nothing rather than falling back to one of
        // the two filters — which is what a dispatch that forgets a branch does.
        assertThat(controller.getEvents("ORDER_VOIDED", "USER", null, null, null, 0, 200).data())
                .as("ORDER_VOIDED is never a USER event; a contradictory filter yields no rows")
                .isEmpty();
    }

    // ── the total, and page two ────────────────────────────────────────────────

    @Test
    @DisplayName("the total is stated and page two holds the rows page one did not")
    void totalIsStatedAndPagingWalksTheWholeSet() {
        for (int i = 0; i < 7; i++) {
            insert("TILL_OPENED", "TILL", minutesAgo(50 - i));
        }

        ApiResponse<List<AuditEventView>> first =
                controller.getEvents("TILL_OPENED", null, null, null, null, 0, 3);

        assertThat(first.data()).hasSize(3);
        assertThat(first.meta())
                .as("""
                    meta was null on every response this endpoint ever gave. A client cannot say
                    "of 208" or know it has reached the end without it — it can only ask for
                    another page and infer.
                    """)
                .isNotNull();
        assertThat(first.meta().totalCount())
                .as("the count of MATCHING rows, not of the page")
                .isEqualTo(7L);
        assertThat(first.meta().page().nextCursor()).isEqualTo("1");

        ApiResponse<List<AuditEventView>> second =
                controller.getEvents("TILL_OPENED", null, null, null, null, 1, 3);
        assertThat(second.data()).hasSize(3);
        assertThat(second.data()).map(AuditEventView::id)
                .doesNotContainAnyElementsOf(first.data().stream().map(AuditEventView::id).toList());

        ApiResponse<List<AuditEventView>> last =
                controller.getEvents("TILL_OPENED", null, null, null, null, 2, 3);
        assertThat(last.data()).hasSize(1);
        assertThat(last.meta().page().nextCursor())
                .as("null nextCursor is the only honest 'this is the end' signal")
                .isNull();
    }

    @Test
    @DisplayName("the total counts the filtered set, not the tenant's whole log")
    void totalRespectsTheFilter() {
        insert("ORDER_VOIDED", "ORDER", minutesAgo(40));
        insert("ORDER_VOIDED", "ORDER", minutesAgo(39));
        for (int i = 0; i < 5; i++) {
            insert("USER_LOGIN_SUCCEEDED", "USER", minutesAgo(35 - i));
        }

        assertThat(controller.getEvents("ORDER_VOIDED", null, null, null, null, 0, 50)
                .meta().totalCount())
                .as("a total that ignores the filter tells the reader their filter did nothing")
                .isEqualTo(2L);
    }

    // ── who did it ─────────────────────────────────────────────────────────────

    @Test
    @DisplayName("a void carries the actor's NAME, not only their id")
    void actorNameIsResolvedForTheRow() {
        UUID cashier = UUID.randomUUID();
        stubDirectory(cashier, "Shift Cashier 984155", "shift.cashier.984155@terrace.local");
        insert("ORDER_VOIDED", "ORDER", minutesAgo(28), cashier, null);

        AuditEventView row = controller.getEvents("ORDER_VOIDED", null, null, null, null, 0, 50)
                .data().getFirst();

        assertThat(row.userId()).isEqualTo(cashier);
        assertThat(row.userName())
                .as("""
                    "by bc0d9897-e0ef-40de-b404-89ce044ab2cb" is an answer only to someone holding
                    a copy of the users table. One screen away, the Voided order list already prints
                    "by Shift Cashier 984155".
                    """)
                .isEqualTo("Shift Cashier 984155");
    }

    @Test
    @DisplayName("an account with no full name falls back to its login email, never to blank")
    void actorNameFallsBackToEmail() {
        UUID user = UUID.randomUUID();
        stubDirectory(user, null, "nameless@terrace.local");
        insert("PASSWORD_CHANGED", "PASSWORD", minutesAgo(27), user, null);

        assertThat(controller.getEvents("PASSWORD_CHANGED", null, null, null, null, 0, 50)
                .data().getFirst().userName())
                .isEqualTo("nameless@terrace.local");
    }

    @Test
    @DisplayName("an impersonated action names both the account acted as and the real administrator")
    void impersonationNamesBothPeople() {
        UUID actedAs = UUID.randomUUID();
        UUID admin = UUID.randomUUID();
        stubDirectory(actedAs, "Terrace Owner", "owner@terrace.local");
        stubDirectory(admin, "Platform Support", "support@softxlogic.com");
        insert("ROLE_GRANTED", "ROLE", minutesAgo(26), actedAs, admin);

        AuditEventView row = controller.getEvents("ROLE_GRANTED", null, null, null, null, 0, 50)
                .data().getFirst();

        assertThat(row.userName()).isEqualTo("Terrace Owner");
        assertThat(row.impersonatedByName())
                .as("attributing an impersonated action to the tenant user alone is the D-34 defect")
                .isEqualTo("Platform Support");
    }

    /**
     * The failure path the stub must not hide.
     *
     * <p>A name is decoration; the row is the evidence. An audit log that returns 500 because a
     * directory is down has made a cosmetic dependency into its own availability.
     */
    @Test
    @DisplayName("an unreachable directory leaves the id and never blanks the row")
    void anUnreachableDirectoryLeavesTheIdAndNeverBlanksTheRow() {
        UUID actor = UUID.randomUUID();
        when(authUserDirectoryClient.getUser(eq(actor), any()))
                .thenThrow(new IllegalStateException("auth-service is not answering"));
        insert("TILL_CLOSED", "TILL", minutesAgo(25), actor, null);

        List<AuditEventView> rows =
                controller.getEvents("TILL_CLOSED", null, null, null, null, 0, 50).data();

        assertThat(rows).hasSize(1);
        assertThat(rows.getFirst().userId()).isEqualTo(actor);
        assertThat(rows.getFirst().userName())
                .as("null, so the screen can print the id — never a placeholder that reads as a person")
                .isNull();
    }

    // ── days are cut where the restaurant is ───────────────────────────────────

    /**
     * A void rung at 01:00 in Karachi, read back by someone asking for "today".
     *
     * <p>Karachi is UTC+5 with no daylight saving, so 01:00 local is 20:00 UTC the PREVIOUS day.
     * To everyone standing in the restaurant that is a row from today. To a server cutting days at
     * UTC midnight it is a row from yesterday, and asking for today loses it.
     *
     * <p>The dates are computed from the clock rather than written down, so this test asserts the
     * same thing tomorrow.
     */
    @Test
    @DisplayName("from/to are cut on the branch zone, not on UTC")
    void dayBoundariesFollowTheBranchZone() {
        ZoneId karachi = ZoneId.of("Asia/Karachi");
        LocalDate todayInKarachi = LocalDate.now(karachi);
        Instant oneAmLocal = todayInKarachi.atStartOfDay(karachi).plusHours(1).toInstant();

        insert("ORDER_VOIDED", "ORDER", oneAmLocal);

        List<AuditEventView> inKarachi = controller.getEvents(
                null, "ORDER", todayInKarachi, todayInKarachi, "Asia/Karachi", 0, 50).data();
        assertThat(inKarachi)
                .as("""
                    01:00 today in Karachi. A manager asked "what happened today" and this is one of
                    the answers. Cutting the day at UTC midnight loses it — the same shape as the
                    Takings screen showing "a zero it does not mean".
                    """)
                .hasSize(1);

        List<AuditEventView> inUtc = controller.getEvents(
                null, "ORDER", todayInKarachi, todayInKarachi, null, 0, 50).data();
        assertThat(inUtc)
                .as("the same instant is genuinely yesterday in UTC — the default is unchanged")
                .isEmpty();
    }

    @Test
    @DisplayName("an unrecognised zone is refused by name, never quietly treated as UTC")
    void unknownZoneIsRefusedRatherThanIgnored() {
        assertThatThrownBy(() -> controller.getEvents(
                null, null, LocalDate.of(2026, 8, 12), LocalDate.of(2026, 8, 12),
                "Mars/Olympus_Mons", 0, 50))
                .isInstanceOf(FieldValidationException.class)
                .satisfies(e -> assertThat(((FieldValidationException) e).getViolations())
                        .as("the client must be told WHICH input it got wrong")
                        .anySatisfy(v -> assertThat(v.field()).isEqualTo("zone")))
                .hasMessageContaining("Mars/Olympus_Mons");
    }

    // ── the filter vocabulary ──────────────────────────────────────────────────

    @Test
    @DisplayName("facets list what this tenant actually has, not what the platform could audit")
    void facetsComeFromTheRows() {
        insert("ORDER_VOIDED", "ORDER", minutesAgo(24));
        insert("USER_LOGIN_SUCCEEDED", "USER", minutesAgo(23));
        insert("USER_LOGIN_SUCCEEDED", "USER", minutesAgo(22));

        AuditFacetsView facets = controller.getFacets(null, null, null).data();

        assertThat(facets.actions())
                .contains("ORDER_VOIDED", "USER_LOGIN_SUCCEEDED")
                .doesNotHaveDuplicates();
        assertThat(facets.resourceTypes())
                .contains("ORDER", "USER")
                .doesNotHaveDuplicates()
                .doesNotContainNull();
        assertThat(facets.actions())
                .as("""
                    an option that can only ever return an empty log reads, on THIS screen, as
                    "your audit trail has a hole in it"
                    """)
                .doesNotContain("PAYROLL_APPROVED");
    }

    /**
     * The default window is bounded, so the facets scan cannot grow without limit.
     *
     * <p>{@code getFacets} defaulted {@code from}/{@code to} to {@code Instant.EPOCH}..{@code now()},
     * which is a {@code SELECT DISTINCT} over every attached partition — 84 of them at the seven-year
     * retention — twice, on every first load of the audit screen. No index can serve it:
     * {@code idx_audit_events_tenant_occurred} carries the tenant but not {@code action}, and
     * {@code idx_audit_events_action} carries {@code action} but cannot prune to a tenant, so the
     * planner reads every row the tenant has ever written and deduplicates it. At 4,010 rows that is
     * instant; the table only grows, and the query gets slower every day it works.
     */
    @Test
    @DisplayName("with no dates given, facets cover the default window and not all of history")
    void facetsAreBoundedToTheDefaultWindow() {
        insert("ORDER_VOIDED", "ORDER", minutesAgo(30));
        insert("PAYROLL_APPROVED", "PAYROLL", daysAgo(200));

        AuditFacetsView facets = controller.getFacets(null, null, null).data();

        assertThat(facets.actions())
                .as("a row inside the default window is still offered")
                .contains("ORDER_VOIDED");
        assertThat(facets.actions())
                .as("""
                    a row 200 days old is outside the default window the grid reads, so offering it
                    would be offering a filter that returns an empty log
                    """)
                .doesNotContain("PAYROLL_APPROVED");
    }

    /**
     * The property the whole design turns on, asserted directly rather than implied.
     *
     * <p>With facets over window F and the grid over window G, an offered option returns rows iff
     * {@code F ⊆ G}. Before this change F = G = all-time, so the property held trivially and this
     * test could not have failed; bounding the windows is exactly the change that could break it, by
     * moving one and not the other. It is a regression guard, not a demonstration — it must stay
     * green, and if it ever reddens it means the two defaults have drifted apart and the screen has
     * started offering filters that can only ever return "no events match".
     */
    @Test
    @DisplayName("every action the facets offer returns at least one row from the same default grid")
    void everyOfferedFacetReturnsRowsInTheGrid() {
        insert("ORDER_VOIDED", "ORDER", minutesAgo(30));
        insert("USER_LOGIN_SUCCEEDED", "USER", daysAgo(45));
        insert("JOURNAL_POSTED", "JOURNAL", daysAgo(89));
        insert("PAYROLL_APPROVED", "PAYROLL", daysAgo(200));

        AuditFacetsView facets = controller.getFacets(null, null, null).data();

        assertThat(facets.actions()).isNotEmpty();
        for (String action : facets.actions()) {
            assertThat(controller.getEvents(action, null, null, null, null, 0, 50).data())
                    .as("the screen offers \"%s\", so selecting it must not empty the log", action)
                    .isNotEmpty();
        }
        for (String resourceType : facets.resourceTypes()) {
            assertThat(controller.getEvents(null, resourceType, null, null, null, 0, 50).data())
                    .as("the screen offers \"%s\", so selecting it must not empty the log", resourceType)
                    .isNotEmpty();
        }
    }

    // ── helpers ────────────────────────────────────────────────────────────────

    /**
     * Each test gets its own tenant, and nothing is ever deleted between them.
     *
     * <p>The obvious alternative — one tenant and a {@code DELETE} in {@code @AfterEach} — cannot be
     * written honestly here: {@code audit_writer} holds no DELETE and a trigger refuses one even
     * from the table's owner, which is the whole point of the table. Reaching around both to
     * tidy up would mean the test suite doing the one thing the schema exists to prevent. A fresh
     * tenant per test is isolation the production code already enforces.
     */
    private void authenticate() {
        SecurityContextHolder.getContext().setAuthentication(
                new UsernamePasswordAuthenticationToken("tester", "n/a",
                        Arrays.stream(new String[]{"audit.log.view"})
                                .map(SimpleGrantedAuthority::new)
                                .map(GrantedAuthority.class::cast)
                                .toList()));
        tenantContext.set(tenant, null, UUID.randomUUID(), null);
    }

    private void stubDirectory(UUID userId, String fullName, String email) {
        when(authUserDirectoryClient.getUser(eq(userId), any()))
                .thenReturn(new AuthUserDirectoryClient.UserDetailEnvelope(
                        new AuthUserDirectoryClient.UserDetailBody(
                                new AuthUserDirectoryClient.UserSummaryBody(userId, email, fullName))));
    }

    /**
     * An instant in the recent past.
     *
     * <p>Not a fixed literal. The endpoint's default upper bound is {@code Instant.now()} — "read
     * up to now" — so a row written with a hardcoded wall-clock time is invisible the moment the
     * machine's clock is earlier than the literal, which is exactly how the first run of this class
     * returned zero rows for nine of eleven tests while the code under test was correct. A test
     * whose green depends on what day it is run is not a test.
     */
    private static Instant minutesAgo(int minutes) {
        return Instant.now().minusSeconds(minutes * 60L);
    }

    /**
     * An instant some days back, for rows either side of the default window.
     *
     * <p>Relative for the same reason as {@link #minutesAgo(int)}, with one extra constraint: it must
     * land in a partition that exists. {@code 010b-initial-partitions} creates 2026-01 through
     * 2027-01, so a value here is bounded by how far back that reaches, not only by the window under
     * test. 200 days is comfortably outside a 90-day window and comfortably inside the partitions.
     */
    private static Instant daysAgo(int days) {
        return Instant.now().minusSeconds(days * 86_400L);
    }

    private void insert(String action, String resourceType, Instant occurredAt) {
        insert(action, resourceType, occurredAt, UUID.randomUUID(), null);
    }

    private void insert(String action, String resourceType, Instant occurredAt,
                        UUID userId, UUID impersonatedBy) {
        tx.execute(status -> {
            AuditEventEntity entity = AuditEventEntity.builder()
                    .occurredAt(occurredAt)
                    .tenantId(tenant)
                    .userId(userId)
                    .impersonatedBy(impersonatedBy)
                    .action(action)
                    .resourceType(resourceType)
                    .build();
            entityManager.persist(entity);
            entityManager.flush();
            return entity.getId();
        });
    }
}
