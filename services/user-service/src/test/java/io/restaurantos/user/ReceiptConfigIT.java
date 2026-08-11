package io.restaurantos.user;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.github.tomakehurst.wiremock.WireMockServer;
import com.github.tomakehurst.wiremock.client.WireMock;
import com.github.tomakehurst.wiremock.core.WireMockConfiguration;
import com.nimbusds.jose.jwk.JWKSet;
import com.nimbusds.jose.jwk.RSAKey;
import io.jsonwebtoken.Jwts;
import io.restaurantos.user.config.UserInternalServiceFilter;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.interfaces.RSAPublicKey;
import java.time.Instant;
import java.util.Date;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static com.github.tomakehurst.wiremock.client.WireMock.aResponse;
import static com.github.tomakehurst.wiremock.client.WireMock.urlEqualTo;
import static org.assertj.core.api.Assertions.assertThat;

/**
 * The printer registry over HTTP, through the real filter chain and the real database.
 *
 * <h2>Why a real signed token rather than a mocked SecurityContext</h2>
 *
 * <p>Two of the behaviours here are ABOUT the filter chain: that the endpoints carry the same
 * authority as a branch write, and that another tenant's branch is not reachable. A test that
 * installs an {@code Authentication} object directly asserts neither. So this mints RS256 tokens
 * against a keypair whose public half a WireMock serves as a JWKS, exactly as {@code UserAdminIT}
 * does, and the service verifies them for real.
 *
 * <h2>The Testcontainers caveat, stated rather than ignored</h2>
 *
 * <p>Testcontainers runs Postgres as a SUPERUSER, and a superuser BYPASSES row-level security. So
 * the cross-tenant assertion below proves the application-level scoping — that the query
 * {@code BranchService.get} issues is confined to the tenant the token carries — and it does NOT
 * prove the RLS policy is doing its job. That half is proven where 17b established it: by
 * {@code RlsForcedInvariantIT} and the non-superuser canary. Both halves are needed and this file
 * is honest about which one it is.
 */
class ReceiptConfigIT extends BaseUserIT {

    private static final String KID = "receipt-config-key";
    private static final KeyPair KEY_PAIR = generateKeyPair();
    private static final WireMockServer WIRE_MOCK;
    private static final String INTERNAL_SECRET = "test-internal-secret";

    private static final UUID ADMIN_ID = UUID.fromString("aa000001-0000-4000-8000-00000000ad01");
    private static final UUID TERMINAL_ID = UUID.fromString("11110000-0000-4000-8000-000000000a01");

    /** The expression BranchController's write endpoints already use. */
    private static final List<String> BRANCH_ADMIN_PERMISSIONS = List.of("branch.manage");
    /** A signed-in user with no branch authority at all. */
    private static final List<String> CASHIER_PERMISSIONS = List.of("pos.order.create");

    private static final ObjectMapper JSON = new ObjectMapper();

    static {
        WIRE_MOCK = new WireMockServer(WireMockConfiguration.wireMockConfig()
                .bindAddress("127.0.0.1").dynamicPort());
        WIRE_MOCK.start();
        WireMock.configureFor("127.0.0.1", WIRE_MOCK.port());
        // Assigned to the mutable static rather than through a second @DynamicPropertySource for
        // the key: BaseUserIT documents why that ordering cannot be relied on.
        jwksUri = "http://127.0.0.1:" + WIRE_MOCK.port() + "/.well-known/jwks.json";
    }

    /**
     * A marker property with no consumer. Its only job is to make this class's
     * {@code MergedContextConfiguration} distinct, so Spring builds a FRESH context rather than
     * handing back one another IT cached with a different {@code jwksUri} — which would leave every
     * token here failing verification for a reason nothing in this file could explain.
     */
    @DynamicPropertySource
    static void distinctContext(DynamicPropertyRegistry r) {
        r.add("restaurantos.test.suite", () -> "receipt-config-it");
    }

    @AfterAll
    static void stopWireMock() {
        if (WIRE_MOCK != null) WIRE_MOCK.stop();
    }

    @BeforeEach
    void stubJwks() {
        WIRE_MOCK.resetAll();
        WIRE_MOCK.stubFor(WireMock.get(urlEqualTo("/.well-known/jwks.json"))
                .willReturn(aResponse().withStatus(200)
                        .withHeader("Content-Type", "application/json")
                        .withBody(jwks())));
    }

    // ══ 1. Round-trip ═════════════════════════════════════════════════════════════════════════

    @Test
    @DisplayName("a TCP receipt printer round-trips through the jsonb column unchanged")
    void configuration_roundTrips() throws Exception {
        UUID branchId = createBranch(TENANT_A, "RT " + UUID.randomUUID());

        ResponseEntity<String> written = putAs(adminToken(), configPath(branchId), fullConfigJson());
        assertThat(written.getStatusCode().value()).isEqualTo(200);

        ResponseEntity<String> read = getAs(adminToken(), configPath(branchId));
        assertThat(read.getStatusCode().value()).isEqualTo(200);

        JsonNode stored = JSON.readTree(read.getBody()).path("data").path("config");
        JsonNode sent = JSON.readTree(fullConfigJson());
        assertThat((Object) stored).isEqualTo(sent);

        JsonNode receipt = stored.path("printers").get(0);
        assertThat(receipt.path("id").asText()).isEqualTo("receipt-1");
        assertThat(receipt.path("transport").asText()).isEqualTo("TCP");
        assertThat(receipt.path("host").asText()).isEqualTo("10.0.7.21");
        assertThat(receipt.path("port").asInt()).isEqualTo(9100);
        assertThat(receipt.path("drawerPin").asInt()).isEqualTo(2);
    }

    // ══ 2. Terminal granularity (D-26-05) ═════════════════════════════════════════════════════

    @Test
    @DisplayName("a null terminal id is the branch default; a per-terminal entry sits beside it")
    void nullTerminalIsTheBranchDefault_andPerTerminalEntriesCoexist() throws Exception {
        UUID branchId = createBranch(TENANT_A, "TERM " + UUID.randomUUID());

        String body = """
            {"agent":{"baseUrl":"http://127.0.0.1:7654","lanUrl":null},
             "printers":[
               %s,
               {"id":"receipt-till-2","terminalId":"%s","role":"RECEIPT","stationCode":null,
                "transport":"TCP","host":"10.0.7.31","port":9100,"systemPrinterName":null,
                "widthMm":80,"columns":48,"columnsMeasured":true,"codepage":"CP437",
                "cut":"PARTIAL","drawerPin":5,"drawerPulseMs":100}],
             "header":null,"footer":null,"fbr":null,"kitchenStations":[]}
            """.formatted(receiptPrinter("receipt-default", null), TERMINAL_ID);

        ResponseEntity<String> res = putAs(adminToken(), configPath(branchId), body);
        assertThat(res.getStatusCode().value()).isEqualTo(200);

        JsonNode printers = JSON.readTree(res.getBody()).path("data").path("config").path("printers");
        assertThat(printers.size()).isEqualTo(2);
        assertThat(printers.get(0).path("terminalId").isNull()).isTrue();
        assertThat(printers.get(1).path("terminalId").asText()).isEqualTo(TERMINAL_ID.toString());
    }

    @Test
    @DisplayName("two printers claiming the same role and terminal are rejected, naming both")
    void duplicateRoutingSlot_isRejected_namingBothEntries() {
        UUID branchId = createBranch(TENANT_A, "DUP " + UUID.randomUUID());

        String body = """
            {"agent":{"baseUrl":"http://127.0.0.1:7654","lanUrl":null},
             "printers":[%s,%s],
             "header":null,"footer":null,"fbr":null,"kitchenStations":[]}
            """.formatted(receiptPrinter("receipt-a", null), receiptPrinter("receipt-b", null));

        ResponseEntity<String> res = putAs(adminToken(), configPath(branchId), body);

        assertThat(res.getStatusCode().value()).isEqualTo(400);
        assertThat(res.getBody()).contains("receipt-a").contains("receipt-b").contains("printers");
    }

    // ══ 3. Transport consistency ══════════════════════════════════════════════════════════════

    @Test
    @DisplayName("TCP with no host, and a port out of range, are each refused naming the field")
    void tcpTransport_requiresHostAndAValidPort() {
        UUID branchId = createBranch(TENANT_A, "TCP " + UUID.randomUUID());

        ResponseEntity<String> noHost = putAs(adminToken(), configPath(branchId),
                singlePrinterConfig("""
                    {"id":"receipt-1","terminalId":null,"role":"RECEIPT","stationCode":null,
                     "transport":"TCP","host":null,"port":9100,"systemPrinterName":null,
                     "widthMm":80,"columns":48,"columnsMeasured":false,"codepage":"CP437",
                     "cut":"PARTIAL","drawerPin":2,"drawerPulseMs":100}"""));
        assertThat(noHost.getStatusCode().value()).isEqualTo(400);
        assertThat(noHost.getBody()).contains("host");

        ResponseEntity<String> badPort = putAs(adminToken(), configPath(branchId),
                singlePrinterConfig("""
                    {"id":"receipt-1","terminalId":null,"role":"RECEIPT","stationCode":null,
                     "transport":"TCP","host":"10.0.7.21","port":70000,"systemPrinterName":null,
                     "widthMm":80,"columns":48,"columnsMeasured":false,"codepage":"CP437",
                     "cut":"PARTIAL","drawerPin":2,"drawerPulseMs":100}"""));
        assertThat(badPort.getStatusCode().value()).isEqualTo(400);
        assertThat(badPort.getBody()).contains("port");
    }

    @Test
    @DisplayName("the system-printer transport with no printer name is refused naming the field")
    void systemTransport_requiresAPrinterName() {
        UUID branchId = createBranch(TENANT_A, "SYS " + UUID.randomUUID());

        ResponseEntity<String> res = putAs(adminToken(), configPath(branchId),
                singlePrinterConfig("""
                    {"id":"receipt-1","terminalId":null,"role":"RECEIPT","stationCode":null,
                     "transport":"SYSTEM","host":null,"port":null,"systemPrinterName":null,
                     "widthMm":80,"columns":48,"columnsMeasured":false,"codepage":"CP437",
                     "cut":"PARTIAL","drawerPin":2,"drawerPulseMs":100}"""));

        assertThat(res.getStatusCode().value()).isEqualTo(400);
        assertThat(res.getBody()).contains("systemPrinterName");
    }

    // ══ 4. Drawer and cut ═════════════════════════════════════════════════════════════════════

    @Test
    @DisplayName("a drawer pin outside {2,5} and an absurd pulse are each refused")
    void drawerPinAndPulse_areBounded() {
        UUID branchId = createBranch(TENANT_A, "DRW " + UUID.randomUUID());

        ResponseEntity<String> badPin = putAs(adminToken(), configPath(branchId),
                singlePrinterConfig("""
                    {"id":"receipt-1","terminalId":null,"role":"RECEIPT","stationCode":null,
                     "transport":"TCP","host":"10.0.7.21","port":9100,"systemPrinterName":null,
                     "widthMm":80,"columns":48,"columnsMeasured":false,"codepage":"CP437",
                     "cut":"PARTIAL","drawerPin":3,"drawerPulseMs":100}"""));
        assertThat(badPin.getStatusCode().value()).isEqualTo(400);
        assertThat(badPin.getBody()).contains("drawerPin");

        ResponseEntity<String> badPulse = putAs(adminToken(), configPath(branchId),
                singlePrinterConfig("""
                    {"id":"receipt-1","terminalId":null,"role":"RECEIPT","stationCode":null,
                     "transport":"TCP","host":"10.0.7.21","port":9100,"systemPrinterName":null,
                     "widthMm":80,"columns":48,"columnsMeasured":false,"codepage":"CP437",
                     "cut":"PARTIAL","drawerPin":2,"drawerPulseMs":90000}"""));
        assertThat(badPulse.getStatusCode().value()).isEqualTo(400);
        assertThat(badPulse.getBody()).contains("drawerPulseMs");
    }

    @Test
    @DisplayName("a cut mode outside the closed set is refused, and the response names the field")
    void cutMode_isAClosedSet() {
        UUID branchId = createBranch(TENANT_A, "CUT " + UUID.randomUUID());

        ResponseEntity<String> res = putAs(adminToken(), configPath(branchId),
                singlePrinterConfig("""
                    {"id":"receipt-1","terminalId":null,"role":"RECEIPT","stationCode":null,
                     "transport":"TCP","host":"10.0.7.21","port":9100,"systemPrinterName":null,
                     "widthMm":80,"columns":48,"columnsMeasured":false,"codepage":"CP437",
                     "cut":"GUILLOTINE","drawerPin":2,"drawerPulseMs":100}"""));

        assertThat(res.getStatusCode().value()).isEqualTo(400);
        // Not the shared handler's bare "Request body is missing or malformed" — the operator has
        // to know WHICH of forty fields they got wrong.
        assertThat(res.getBody()).contains("cut");
        assertThat(res.getBody()).doesNotContain("INTERNAL_ERROR");
    }

    // ══ 5. Columns are measured, not assumed (research §7.5) ══════════════════════════════════

    @Test
    @DisplayName("a column count is stored with an explicit unmeasured flag, and can be confirmed")
    void columnsCarryAMeasuredFlag_andAWarningUntilConfirmed() throws Exception {
        UUID branchId = createBranch(TENANT_A, "COL " + UUID.randomUUID());

        ResponseEntity<String> unmeasured = putAs(adminToken(), configPath(branchId),
                singlePrinterConfig(receiptPrinter("receipt-1", null)));
        assertThat(unmeasured.getStatusCode().value()).isEqualTo(200);

        JsonNode body = JSON.readTree(unmeasured.getBody()).path("data");
        assertThat(body.path("config").path("printers").get(0).path("columnsMeasured").asBoolean()).isFalse();
        assertThat(body.path("completeness").path("warnings").toString())
                .contains("UNMEASURED").contains("receipt-1");

        ResponseEntity<String> measured = putAs(adminToken(), configPath(branchId),
                singlePrinterConfig("""
                    {"id":"receipt-1","terminalId":null,"role":"RECEIPT","stationCode":null,
                     "transport":"TCP","host":"10.0.7.21","port":9100,"systemPrinterName":null,
                     "widthMm":80,"columns":42,"columnsMeasured":true,"codepage":"CP437",
                     "cut":"PARTIAL","drawerPin":2,"drawerPulseMs":100}"""));
        JsonNode after = JSON.readTree(measured.getBody()).path("data");
        assertThat(after.path("config").path("printers").get(0).path("columnsMeasured").asBoolean()).isTrue();
        assertThat(after.path("config").path("printers").get(0).path("columns").asInt()).isEqualTo(42);
        assertThat(after.path("completeness").path("warnings").toString()).doesNotContain("UNMEASURED");
    }

    // ══ 6. An unrouted kitchen station is SAVED and REPORTED, never silent ════════════════════

    @Test
    @DisplayName("a kitchen station with no printer saves, and the response names it")
    void unroutedKitchenStations_areSavedAndNamed() throws Exception {
        UUID branchId = createBranch(TENANT_A, "STN " + UUID.randomUUID());

        ResponseEntity<String> res = putAs(adminToken(), configPath(branchId), fullConfigJson());
        assertThat(res.getStatusCode().value()).isEqualTo(200);

        JsonNode completeness = JSON.readTree(res.getBody()).path("data").path("completeness");
        assertThat(completeness.path("complete").asBoolean()).isFalse();
        assertThat(completeness.path("unroutedStations").toString()).contains("COLD");
        assertThat(completeness.path("unroutedStations").toString()).doesNotContain("HOT");

        // And it is still there on the way back out — saved, not rejected.
        JsonNode reread = JSON.readTree(getAs(adminToken(), configPath(branchId)).getBody()).path("data");
        assertThat(reread.path("config").path("kitchenStations").toString()).contains("COLD");
        assertThat(reread.path("completeness").path("unroutedStations").toString()).contains("COLD");
    }

    // ══ 7. Never configured is an EMPTY configuration, not a 404 and not a null ═══════════════

    @Test
    @DisplayName("a branch nobody configured returns an explicitly empty configuration")
    void neverConfigured_returnsAnEmptyConfiguration_notNullAndNot404() throws Exception {
        UUID branchId = createBranch(TENANT_A, "EMPTY " + UUID.randomUUID());

        ResponseEntity<String> res = getAs(adminToken(), configPath(branchId));

        assertThat(res.getStatusCode().value()).isEqualTo(200);
        JsonNode data = JSON.readTree(res.getBody()).path("data");
        assertThat(data.path("config").isNull()).isFalse();
        assertThat(data.path("config").path("printers").isArray()).isTrue();
        assertThat(data.path("config").path("printers").size()).isZero();
        assertThat(data.path("config").path("agent").isNull()).isTrue();
        assertThat(data.path("completeness").path("complete").asBoolean()).isFalse();
    }

    // ══ 8. Authority and tenancy ══════════════════════════════════════════════════════════════

    @Test
    @DisplayName("a signed-in user without branch authority may neither read nor write the registry")
    void withoutBranchAuthority_bothEndpointsRefuse() {
        UUID branchId = createBranch(TENANT_A, "AUTH " + UUID.randomUUID());
        String cashier = tokenFor(ADMIN_ID, TENANT_A, CASHIER_PERMISSIONS);

        assertThat(getAs(cashier, configPath(branchId)).getStatusCode().value()).isEqualTo(403);
        assertThat(putAs(cashier, configPath(branchId), fullConfigJson())
                .getStatusCode().value()).isEqualTo(403);
    }

    @Test
    @DisplayName("another tenant's branch is not found — never 200 with someone else's printers")
    void anotherTenantsBranch_isNotFound() {
        UUID foreignBranch = createBranch(TENANT_B, "FOREIGN " + UUID.randomUUID());

        ResponseEntity<String> read = getAs(adminToken(), configPath(foreignBranch));
        assertThat(read.getStatusCode().value()).isEqualTo(404);
        assertThat(read.getBody()).doesNotContain("10.0.7.");

        ResponseEntity<String> write = putAs(adminToken(), configPath(foreignBranch), fullConfigJson());
        assertThat(write.getStatusCode().value()).isEqualTo(404);
    }

    // ══ 9. The legacy door is CLOSED, not merely bypassed ════════════════════════════════════

    @Test
    @DisplayName("a branch update carrying the legacy receiptConfig string is refused, and the stored registry survives")
    void legacyBareStringWrite_isRefused_andCannotClobberAValidatedRegistry() throws Exception {
        UUID branchId = createBranch(TENANT_A, "LEGACY " + UUID.randomUUID());

        // 1. Write a valid registry through the new endpoint.
        assertThat(putAs(adminToken(), configPath(branchId), fullConfigJson())
                .getStatusCode().value()).isEqualTo(200);

        // 2. Try to overwrite it with arbitrary text through the branch endpoint.
        ResponseEntity<String> legacy = putAs(adminToken(), "/api/v1/branches/" + branchId,
                "{\"receiptConfig\":\"total nonsense\"}");
        assertThat(legacy.getStatusCode().value()).isEqualTo(400);
        assertThat(legacy.getBody()).contains("receipt-config");
        assertThat(legacy.getBody()).contains("RECEIPT_CONFIG_LEGACY_WRITE");

        // 3. The registry is intact.
        JsonNode after = JSON.readTree(getAs(adminToken(), configPath(branchId)).getBody())
                .path("data").path("config");
        assertThat(after.path("printers").size()).isEqualTo(2);
        assertThat(after.path("printers").get(0).path("host").asText()).isEqualTo("10.0.7.21");
    }

    @Test
    @DisplayName("an ordinary branch update with no receiptConfig still succeeds exactly as before")
    void branchUpdateWithoutReceiptConfig_isUnaffected() {
        UUID branchId = createBranch(TENANT_A, "PLAIN " + UUID.randomUUID());
        String renamed = "Renamed " + UUID.randomUUID();

        ResponseEntity<String> res = putAs(adminToken(), "/api/v1/branches/" + branchId,
                "{\"name\":\"" + renamed + "\"}");

        assertThat(res.getStatusCode().value()).isEqualTo(200);
        assertThat(res.getBody()).contains(renamed);
    }

    @Test
    @DisplayName("creating a branch with a legacy receiptConfig is refused too")
    void branchCreateWithLegacyReceiptConfig_isRefused() {
        ResponseEntity<String> res = post("/api/v1/branches", Map.of(
                "name", "Create " + UUID.randomUUID(),
                "isHq", false,
                "receiptConfig", "{\"printers\":[]}"));
        // No token: the create endpoint is permission-gated, so assert through an authorised call.
        assertThat(res.getStatusCode().value()).isIn(401, 403);

        ResponseEntity<String> authorised = postAs(adminToken(), "/api/v1/branches",
                "{\"name\":\"Create " + UUID.randomUUID() + "\",\"isHq\":false,"
                        + "\"receiptConfig\":\"{}\"}");
        assertThat(authorised.getStatusCode().value()).isEqualTo(400);
        assertThat(authorised.getBody()).contains("receipt-config");
    }

    // ══ Helpers ══════════════════════════════════════════════════════════════════════════════

    private static String configPath(UUID branchId) {
        return "/api/v1/branches/" + branchId + "/receipt-config";
    }

    private UUID createBranch(UUID tenantId, String name) {
        setRls(tenantId);
        ResponseEntity<String> created = postWithHeader("/internal/users/branches",
                Map.of("tenantId", tenantId.toString(), "name", name, "isHq", false),
                UserInternalServiceFilter.HEADER, INTERNAL_SECRET);
        assertThat(created.getStatusCode().value()).isEqualTo(201);
        try {
            // The internal endpoint returns InternalCreateBranchResponse directly, NOT wrapped in
            // ApiResponse — unlike every /api/v1 endpoint in this file.
            return UUID.fromString(JSON.readTree(created.getBody()).path("branchId").asText());
        } catch (Exception e) {
            throw new IllegalStateException("could not read branchId from " + created.getBody(), e);
        }
    }

    /** A receipt printer over TCP with an UNMEASURED column count. */
    private static String receiptPrinter(String id, UUID terminalId) {
        return """
            {"id":"%s","terminalId":%s,"role":"RECEIPT","stationCode":null,"transport":"TCP",
             "host":"10.0.7.21","port":9100,"systemPrinterName":null,"widthMm":80,"columns":48,
             "columnsMeasured":false,"codepage":"CP437","cut":"PARTIAL","drawerPin":2,
             "drawerPulseMs":100}"""
                .formatted(id, terminalId == null ? "null" : "\"" + terminalId + "\"");
    }

    private static String singlePrinterConfig(String printerJson) {
        return """
            {"agent":{"baseUrl":"http://127.0.0.1:7654","lanUrl":null},
             "printers":[%s],
             "header":null,"footer":null,"fbr":null,"kitchenStations":[]}
            """.formatted(printerJson);
    }

    /**
     * The realistic registry: an agent, a counter printer with a drawer, a hot-station kitchen
     * printer, and a declared COLD station that nothing routes — which is exactly the half-finished
     * state a branch is in halfway through onboarding.
     */
    private static String fullConfigJson() {
        return """
            {"agent":{"baseUrl":"http://127.0.0.1:7654","lanUrl":"http://till-01.local:7654"},
             "printers":[
               {"id":"receipt-1","terminalId":null,"role":"RECEIPT","stationCode":null,
                "transport":"TCP","host":"10.0.7.21","port":9100,"systemPrinterName":null,
                "widthMm":80,"columns":48,"columnsMeasured":true,"codepage":"CP864",
                "cut":"PARTIAL","drawerPin":2,"drawerPulseMs":100},
               {"id":"kitchen-hot","terminalId":null,"role":"KITCHEN","stationCode":"HOT",
                "transport":"TCP","host":"10.0.7.22","port":9100,"systemPrinterName":null,
                "widthMm":80,"columns":42,"columnsMeasured":true,"codepage":"CP437",
                "cut":"FULL","drawerPin":null,"drawerPulseMs":null}],
             "header":{"logoFileId":null,"lines":["Floating Terrace","F-7 Markaz, Islamabad"]},
             "footer":{"lines":["Thank you"]},
             "fbr":{"printLogo":true,"qrSizeMm":25.4},
             "kitchenStations":["HOT","COLD"]}
            """;
    }

    private String adminToken() {
        return tokenFor(ADMIN_ID, TENANT_A, BRANCH_ADMIN_PERMISSIONS);
    }

    private static String tokenFor(UUID subject, UUID tenantId, List<String> permissions) {
        return Jwts.builder()
                .header().keyId(KID).and()
                .subject(subject.toString())
                .claim("tenant_id", tenantId.toString())
                .claim("roles", List.of("TENANT_ADMIN"))
                .claim("permissions", permissions)
                .issuedAt(Date.from(Instant.now()))
                .expiration(Date.from(Instant.now().plusSeconds(600)))
                .signWith(KEY_PAIR.getPrivate(), Jwts.SIG.RS256)
                .compact();
    }

    private static String jwks() {
        return new JWKSet(new RSAKey.Builder((RSAPublicKey) KEY_PAIR.getPublic()).keyID(KID).build())
                .toString();
    }

    private static KeyPair generateKeyPair() {
        try {
            KeyPairGenerator gen = KeyPairGenerator.getInstance("RSA");
            gen.initialize(2048);
            return gen.generateKeyPair();
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    private ResponseEntity<String> getAs(String token, String uri) {
        return rest.get().uri(uri).header("Authorization", "Bearer " + token)
                .exchange((req, res) -> toEntity(res), false);
    }

    private ResponseEntity<String> putAs(String token, String uri, String body) {
        return rest.put().uri(uri)
                .contentType(MediaType.APPLICATION_JSON)
                .header("Authorization", "Bearer " + token)
                .body(body)
                .exchange((req, res) -> toEntity(res), false);
    }

    private ResponseEntity<String> postAs(String token, String uri, String body) {
        return rest.post().uri(uri)
                .contentType(MediaType.APPLICATION_JSON)
                .header("Authorization", "Bearer " + token)
                .body(body)
                .exchange((req, res) -> toEntity(res), false);
    }
}
