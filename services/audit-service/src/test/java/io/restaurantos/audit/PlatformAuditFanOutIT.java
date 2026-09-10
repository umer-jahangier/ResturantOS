package io.restaurantos.audit;

import io.restaurantos.audit.dto.PlatformAuditDtos.PlatformAuditEventView;
import io.restaurantos.audit.dto.PlatformAuditDtos.PlatformAuditSearchRequest;
import io.restaurantos.audit.dto.PlatformAuditDtos.PlatformAuditSearchResponse;
import io.restaurantos.audit.service.PlatformAuditReadService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.http.MediaType;
import org.springframework.web.client.RestClient;

import java.sql.Connection;
import java.sql.SQLException;
import java.sql.Statement;
import java.time.Instant;
import java.time.LocalDate;
import java.util.Comparator;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * The platform-tier cross-tenant audit read, and the bug it was built on top of.
 *
 * <h2>The discriminating test</h2>
 *
 * <p>{@link #internalPerTenantReadReturnsRows()} is the one that matters most, and it is the
 * cheapest to get wrong. {@code GET /internal/audit/events?tenantId=…} filtered by tenant in JPA
 * and set no {@code app.current_tenant_id} on the connection. Under changeset 030's
 * {@code FORCE ROW LEVEL SECURITY} — parent and every partition — the GUC was the empty string,
 * the policy mapped that to NULL, and the endpoint returned <b>200 with an empty array for every
 * tenant on the platform</b>. Not an error, not a log line: a well-formed answer meaning "this
 * tenant has never done anything".
 *
 * <p>That is exactly the class of defect this suite exists for, and it survived because the only
 * other tests over this service connect as the Testcontainers SUPERUSER, which PostgreSQL exempts
 * from RLS unconditionally. Over a superuser connection the endpoint works perfectly. So this class
 * extends {@link BaseAuditRlsIT}, whose application datasource is {@code audit_admin} —
 * {@code NOSUPERUSER NOBYPASSRLS}, and the table OWNER, which is the harder case because PostgreSQL
 * exempts an owner from its own policies unless FORCE is set.
 *
 * <h2>Every assertion carries a positive control</h2>
 *
 * <p>A cross-tenant read has two ways to be wrong and they point in opposite directions: it can
 * return another tenant's rows, or it can return nothing at all. A test asserting only "tenant B's
 * rows are absent" passes on a completely broken read. So each assertion below pairs the foreign
 * count with the own count, over the same call.
 */
class PlatformAuditFanOutIT extends BaseAuditRlsIT {

    @Autowired private PlatformAuditReadService platformAuditReadService;
    @LocalServerPort private int port;

    /**
     * Fresh tenants per method. {@code audit_events} is append-only at the trigger layer, so there
     * is no cleanup between tests and none should be added — tests do not get a privilege the
     * product denies itself. Randomised tenants make each method's rows invisible to every other
     * method's assertions by the very policy under test.
     */
    private final UUID tenantA = UUID.randomUUID();
    private final UUID tenantB = UUID.randomUUID();
    private final UUID tenantC = UUID.randomUUID();

    private final UUID actor = UUID.randomUUID();

    @BeforeEach
    void seed() throws SQLException {
        try (Connection c = asWriter(); Statement s = c.createStatement()) {
            s.execute("SELECT create_audit_partition(DATE '"
                    + LocalDate.now().withDayOfMonth(1) + "')");
        }
        // Seeded as the SUPERUSER on purpose: a leak needs something to leak, and tenant B's rows
        // could not be written over a connection scoped to tenant A.
        try (Connection c = asOwner(); Statement s = c.createStatement()) {
            insert(s, tenantA, "USER_LOGIN_SUCCEEDED", actor, "NOW() - INTERVAL '3 minutes'");
            insert(s, tenantA, "ROLE_GRANTED", actor, "NOW() - INTERVAL '2 minutes'");
            insert(s, tenantB, "USER_LOGIN_FAILED", null, "NOW() - INTERVAL '1 minute'");
            insert(s, tenantC, "ORDER_VOIDED", null, "NOW()");
        }
    }

    private static void insert(Statement s, UUID tenantId, String action, UUID userId, String at)
            throws SQLException {
        s.execute("INSERT INTO audit_events (tenant_id, user_id, action, resource_type, occurred_at)"
                + " VALUES ('" + tenantId + "', "
                + (userId == null ? "NULL" : "'" + userId + "'") + ", '"
                + action + "', 'FANOUT', " + at + ")");
    }

    @Test
    @DisplayName("the platform read returns rows for every tenant it names, and only those tenants")
    void readsNamedTenantsAndOnlyThose() {
        PlatformAuditSearchResponse response = platformAuditReadService.search(request(
                List.of(tenantA, tenantB), null, null, null, 0, 50));

        List<UUID> tenants = response.events().stream()
                .map(PlatformAuditEventView::tenantId).distinct().sorted().toList();

        assertThat(response.events())
                .as("""
                    POSITIVE CONTROL — the read returned NOTHING for two tenants that each have \
                    seeded rows. That is the exact shape of the defect this endpoint was built to \
                    fix: FORCE ROW LEVEL SECURITY with no app.current_tenant_id on the connection \
                    matches zero rows and reports success. Check that the loop in \
                    PlatformAuditReadService still sets TenantContext per tenant, and that nothing \
                    wrapped it in an outer transaction that pins one connection to one GUC.""")
                .isNotEmpty();

        assertThat(tenants)
                .as("both named tenants must be represented, and no unnamed tenant may appear")
                .containsExactlyInAnyOrder(tenantA, tenantB);

        assertThat(response.events().stream()
                .filter(e -> e.tenantId().equals(tenantC)).toList())
                .as("""
                    tenant C was NOT named in the request and its rows came back anyway. The \
                    cross-tenant view is assembled from per-tenant policy-checked reads precisely \
                    so this cannot happen; if it does, either the GUC is not moving between \
                    iterations or a policy has been dropped.""")
                .isEmpty();

        assertThat(response.totalCount())
                .as("three rows across the two named tenants, counted exactly rather than estimated")
                .isEqualTo(3);
        assertThat(response.totalCountComplete())
                .as("no tenant failed, so the total is a fact and not a lower bound")
                .isTrue();
        assertThat(response.tenantsRead()).containsExactlyInAnyOrder(tenantA, tenantB);
        assertThat(response.tenantsFailed()).isEmpty();
    }

    @Test
    @DisplayName("naming one tenant returns that tenant's rows and none of the others'")
    void singleTenantScopeIsIsolated() {
        PlatformAuditSearchResponse response = platformAuditReadService.search(request(
                List.of(tenantA), null, null, null, 0, 50));

        assertThat(response.events())
                .as("POSITIVE CONTROL — tenant A has two seeded rows; zero here means the read is "
                    + "broken, not that isolation is working")
                .hasSize(2);
        assertThat(response.events())
                .allSatisfy(event -> assertThat(event.tenantId()).isEqualTo(tenantA));
    }

    @Test
    @DisplayName("the merge across tenants is newest-first, not tenant-by-tenant")
    void mergeIsOrderedByTimeAcrossTenants() {
        PlatformAuditSearchResponse response = platformAuditReadService.search(request(
                List.of(tenantA, tenantB, tenantC), null, null, null, 0, 50));

        List<Instant> occurredAt = response.events().stream()
                .map(PlatformAuditEventView::occurredAt).toList();

        assertThat(occurredAt)
                .as("""
                    The page is assembled from N per-tenant reads. Returning them concatenated \
                    rather than merged would put every one of tenant A's rows above every one of \
                    tenant B's regardless of when they happened — a chronological log that is not \
                    in chronological order.""")
                .isSortedAccordingTo(Comparator.reverseOrder());

        assertThat(response.events().get(0).action())
                .as("the newest seeded row across all three tenants is tenant C's")
                .isEqualTo("ORDER_VOIDED");
    }

    @Test
    @DisplayName("the action filter narrows without needing a nullable bind parameter")
    void actionFilterNarrows() {
        PlatformAuditSearchResponse response = platformAuditReadService.search(request(
                List.of(tenantA, tenantB, tenantC),
                List.of("USER_LOGIN_SUCCEEDED", "USER_LOGIN_FAILED"), null, null, 0, 50));

        assertThat(response.events()).hasSize(2);
        assertThat(response.events()).allSatisfy(event ->
                assertThat(event.action()).startsWith("USER_LOGIN_"));
        assertThat(response.totalCount())
                .as("the total must reflect the FILTER, not the whole log — a pager whose count "
                    + "ignores the filter tells the reader rows are missing")
                .isEqualTo(2);
    }

    @Test
    @DisplayName("the actor filter matches the acting account OR the impersonator behind it")
    void actorFilterMatchesBothColumns() {
        PlatformAuditSearchResponse response = platformAuditReadService.search(request(
                List.of(tenantA, tenantB, tenantC), null, actor, null, 0, 50));

        assertThat(response.events())
                .as("both of tenant A's rows carry this actor in user_id")
                .hasSize(2);
        assertThat(response.events()).allSatisfy(event ->
                assertThat(event.userId()).isEqualTo(actor));
    }

    @Test
    @DisplayName("facets are read from the rows, so a filter cannot offer a value that returns none")
    void facetsComeFromTheData() {
        PlatformAuditSearchResponse response = platformAuditReadService.search(
                new PlatformAuditSearchRequest(List.of(tenantA, tenantB), null, null, null,
                        Instant.now().minusSeconds(3600), Instant.now().plusSeconds(60),
                        0, 50, true));

        assertThat(response.actionsPresent())
                .as("null would mean 'facets were not requested'; they were")
                .isNotNull();
        assertThat(response.actionsPresent())
                .contains("USER_LOGIN_SUCCEEDED", "ROLE_GRANTED", "USER_LOGIN_FAILED")
                .doesNotContain("ORDER_VOIDED");
    }

    @Test
    @DisplayName("an empty scope is refused, never widened to every tenant")
    void emptyScopeIsRefused() {
        assertThatThrownBy(() -> platformAuditReadService.search(
                new PlatformAuditSearchRequest(List.of(), null, null, null, null, null, 0, 50, false)))
                .as("""
                    An omitted scope must be a refusal. The one default this endpoint must never \
                    have is one that reads MORE than the caller asked for — on this table that is \
                    every login, void, refund and role change for every tenant on the platform.""")
                .isInstanceOf(IllegalArgumentException.class);
    }

    /**
     * The endpoint the platform plane's Feign client actually calls, over HTTP, through the
     * internal-secret filter.
     *
     * <p>The service-level tests above prove the RLS semantics; this proves the wiring — that the
     * secret header the filter expects is the one being sent, and that the response deserialises
     * into the shape the client binds.
     */
    @Test
    @DisplayName("POST /internal/audit/platform/search returns the merged page over HTTP")
    void httpEndpointReturnsTheMergedPage() {
        RestClient rest = RestClient.builder()
                .requestFactory(new org.springframework.http.client.JdkClientHttpRequestFactory())
                .baseUrl("http://127.0.0.1:" + port)
                .build();

        String body = rest.post()
                .uri("/internal/audit/platform/search")
                .header("X-Internal-Service-Secret", "test-internal-secret")
                .contentType(MediaType.APPLICATION_JSON)
                .body(new PlatformAuditSearchRequest(
                        List.of(tenantA), null, null, null, null, null, 0, 50, false))
                .retrieve()
                .body(String.class);

        assertThat(body)
                .as("the ApiResponse envelope carries the search under data")
                .contains("\"totalCount\":2")
                .contains(tenantA.toString());
    }

    /**
     * The fixed endpoint. This is the assertion that would have failed before the GUC was set.
     *
     * <p>Deliberately over the ORIGINAL contract — {@code GET /internal/audit/events?tenantId=} with
     * its unchanged {@code ApiResponse<List<AuditEventEntity>>} shape — because the fix must not
     * have been a rewrite: anything already calling this endpoint keeps working, and now receives
     * the rows it was always supposed to.
     */
    @Test
    @DisplayName("GET /internal/audit/events returns a tenant's rows rather than an empty list")
    void internalPerTenantReadReturnsRows() {
        RestClient rest = RestClient.builder()
                .requestFactory(new org.springframework.http.client.JdkClientHttpRequestFactory())
                .baseUrl("http://127.0.0.1:" + port)
                .build();

        String body = rest.get()
                .uri("/internal/audit/events?tenantId=" + tenantA + "&size=50")
                .header("X-Internal-Service-Secret", "test-internal-secret")
                .retrieve()
                .body(String.class);

        assertThat(body)
                .as("""
                    This endpoint returned {"data":[]} for every tenant in existence: it took the \
                    tenant as a query parameter, filtered in JPA, and never populated \
                    TenantContext — so TenantAwareDataSource wrote an EMPTY \
                    app.current_tenant_id, changeset 030's FORCE policy mapped that to NULL, and \
                    the read matched nothing while answering 200. An empty audit log is \
                    indistinguishable from a quiet tenant, which is why nobody noticed.""")
                .contains("ROLE_GRANTED")
                .contains("USER_LOGIN_SUCCEEDED");
    }

    @Test
    @DisplayName("the internal secret is required — a missing header is refused, not served")
    void internalSecretIsEnforced() {
        RestClient rest = RestClient.builder()
                .requestFactory(new org.springframework.http.client.JdkClientHttpRequestFactory())
                .baseUrl("http://127.0.0.1:" + port)
                .build();

        var response = rest.post()
                .uri("/internal/audit/platform/search")
                .contentType(MediaType.APPLICATION_JSON)
                .body(new PlatformAuditSearchRequest(
                        List.of(tenantA), null, null, null, null, null, 0, 50, false))
                .exchange((req, res) -> res.getStatusCode(), false);

        assertThat(response.is4xxClientError())
                .as("a cross-tenant audit read with no internal credential must be refused")
                .isTrue();
    }

    private static PlatformAuditSearchRequest request(List<UUID> tenantIds,
                                                      List<String> actions,
                                                      UUID userId,
                                                      String resourceType,
                                                      int page,
                                                      int size) {
        return new PlatformAuditSearchRequest(
                tenantIds, actions, resourceType, userId, null, null, page, size, false);
    }
}
