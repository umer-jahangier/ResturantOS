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

import java.nio.charset.StandardCharsets;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.interfaces.RSAPublicKey;
import java.sql.Connection;
import java.sql.ResultSet;
import java.sql.Statement;
import java.time.Instant;
import java.util.Date;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static com.github.tomakehurst.wiremock.client.WireMock.aResponse;
import static com.github.tomakehurst.wiremock.client.WireMock.urlEqualTo;
import static org.assertj.core.api.Assertions.assertThat;

/**
 * A branch address is plain text, over HTTP, end to end (S4).
 *
 * <h2>The defect this file is the regression guard for</h2>
 *
 * <p>{@code branches.address} was declared {@code jsonb} while every writer and reader treated it
 * as a bare {@code String}, so PostgreSQL rejected anything that was not valid JSON and the
 * driver's error reached the owner as <b>409 CONFLICT — "This conflicts with existing data"</b>.
 * Measured live through the gateway on 2026-08-12, all three replicated:
 *
 * <pre>
 *   {"address":"12 Khayaban-e-Iqbal, F-7 Markaz, Islamabad"}  -> 409
 *   {"address":"Islamabad"}                                   -> 409
 *   {"address":"\"12 Khayaban-e-Iqbal\""}                     -> 200, persisted
 * </pre>
 *
 * <p>The only accepted input was the one shape no human would type. Every test below fails with a
 * 409 against the pre-021 schema — verified by running this class against it, not assumed.
 *
 * <h2>Why the round trip is asserted on the READ and not on the write's 200</h2>
 *
 * <p>A 200 from a write says the row was accepted, not that the value survives. The address the
 * owner typed has to come back byte for byte from a separate GET, because the settings form
 * repopulates itself from exactly that read — and a value that comes back quoted, escaped or
 * flattened is the same defect wearing a success code.
 */
class BranchAddressIT extends BaseUserIT {

    private static final String KID = "branch-address-key";
    private static final KeyPair KEY_PAIR = generateKeyPair();
    private static final WireMockServer WIRE_MOCK;
    private static final String INTERNAL_SECRET = "test-internal-secret";
    private static final UUID ADMIN_ID = UUID.fromString("aa000001-0000-4000-8000-00000000ad02");
    private static final List<String> BRANCH_ADMIN_PERMISSIONS = List.of("branch.manage");
    private static final ObjectMapper JSON = new ObjectMapper();

    /** Verbatim from the item's DONE MEANS, quote marks conspicuously absent. */
    private static final String ADDRESS = "12 Khayaban-e-Iqbal, F-7 Markaz, Islamabad";

    static {
        WIRE_MOCK = new WireMockServer(WireMockConfiguration.wireMockConfig()
                .bindAddress("127.0.0.1").dynamicPort());
        WIRE_MOCK.start();
        WireMock.configureFor("127.0.0.1", WIRE_MOCK.port());
        jwksUri = "http://127.0.0.1:" + WIRE_MOCK.port() + "/.well-known/jwks.json";
    }

    /** See {@code ReceiptConfigIT}: a marker property so this class gets its own Spring context. */
    @DynamicPropertySource
    static void distinctContext(DynamicPropertyRegistry r) {
        r.add("restaurantos.test.suite", () -> "branch-address-it");
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

    // ══ 1. The address in DONE MEANS ═════════════════════════════════════════════════════════

    @Test
    @DisplayName("a street address with no quote marks saves, reads back byte for byte, and re-saves")
    void plainAddress_saves_roundTrips_andSavesAgain() throws Exception {
        UUID branchId = createBranch(TENANT_A, "ADDR " + UUID.randomUUID());

        ResponseEntity<String> first = putAs(adminToken(), branchPath(branchId),
                JSON.writeValueAsString(Map.of("address", ADDRESS)));
        assertThat(first.getStatusCode().value())
                .describedAs("plain address rejected: %s", first.getBody())
                .isEqualTo(200);

        assertThat(storedAddress(branchId)).isEqualTo(ADDRESS);

        // Saving the SAME value again is what a user does when they correct a neighbouring field.
        ResponseEntity<String> again = putAs(adminToken(), branchPath(branchId),
                JSON.writeValueAsString(Map.of("address", ADDRESS)));
        assertThat(again.getStatusCode().value())
                .describedAs("re-saving the same address: %s", again.getBody())
                .isEqualTo(200);
        assertThat(storedAddress(branchId)).isEqualTo(ADDRESS);
    }

    @Test
    @DisplayName("one word, a comma, an ampersand and an apostrophe are all just text")
    void ordinaryPunctuation_isNotSyntax() throws Exception {
        for (String candidate : List.of(
                "Islamabad",
                "44000",
                "Shop 3 & 4, Gulberg III, Lahore",
                "O'Connell's, Block B, Karachi",
                "Plot 5 \"The Annexe\", Multan")) {
            UUID branchId = createBranch(TENANT_A, "PUNCT " + UUID.randomUUID());
            ResponseEntity<String> res = putAs(adminToken(), branchPath(branchId),
                    JSON.writeValueAsString(Map.of("address", candidate)));
            assertThat(res.getStatusCode().value())
                    .describedAs("address %s rejected: %s", candidate, res.getBody())
                    .isEqualTo(200);
            assertThat(storedAddress(branchId)).isEqualTo(candidate);
        }
    }

    @Test
    @DisplayName("a multi-line address keeps its line breaks — the receipt prints them as lines")
    void multiLineAddress_survives() throws Exception {
        UUID branchId = createBranch(TENANT_A, "LINES " + UUID.randomUUID());
        String multi = "12 Khayaban-e-Iqbal\nF-7 Markaz\nIslamabad 44000";

        assertThat(putAs(adminToken(), branchPath(branchId),
                JSON.writeValueAsString(Map.of("address", multi)))
                .getStatusCode().value()).isEqualTo(200);
        assertThat(storedAddress(branchId)).isEqualTo(multi);
    }

    @Test
    @DisplayName("an omitted address leaves the stored one alone; an empty one clears it")
    void patchSemanticsSurviveTheTypeChange() throws Exception {
        UUID branchId = createBranch(TENANT_A, "PATCH " + UUID.randomUUID());
        putAs(adminToken(), branchPath(branchId), JSON.writeValueAsString(Map.of("address", ADDRESS)));

        // A rename that says nothing about the address must not touch it.
        assertThat(putAs(adminToken(), branchPath(branchId),
                JSON.writeValueAsString(Map.of("name", "Renamed " + UUID.randomUUID())))
                .getStatusCode().value()).isEqualTo(200);
        assertThat(storedAddress(branchId)).isEqualTo(ADDRESS);

        // An explicit empty string is the user clearing the box, and it must take.
        assertThat(putAs(adminToken(), branchPath(branchId),
                JSON.writeValueAsString(Map.of("address", "")))
                .getStatusCode().value()).isEqualTo(200);
        assertThat(storedAddress(branchId)).isEmpty();
    }

    // ══ 2. The column really is text — the changeset RAN, it does not merely exist ════════════

    @Test
    @DisplayName("branches.address is a text column in the migrated schema")
    void theColumnIsText() throws Exception {
        try (Connection c = asOwner(); Statement s = c.createStatement();
             ResultSet rs = s.executeQuery("""
                     SELECT data_type FROM information_schema.columns
                      WHERE table_name = 'branches' AND column_name = 'address'
                     """)) {
            assertThat(rs.next()).isTrue();
            assertThat(rs.getString(1)).isEqualTo("text");
        }
    }

    // ══ 3. The rows that already existed ═════════════════════════════════════════════════════

    /**
     * The data half of changeset 021, run through the changeset's OWN statement.
     *
     * <p>The conversion cannot be observed on {@code branches} itself from a test: Liquibase runs
     * 021 against an empty schema at context start, so by the time any test executes there is no
     * pre-migration row left to convert. So this applies the identical SQL — loaded from
     * {@code 021-branch-address-jsonb-to-text-fn.sql}, the same resource {@code <sqlFile>} feeds
     * to the migration — to a fixture table holding the three shapes that exist in the live
     * {@code user_db} today. Asserting a hand-copied version of the statement would prove only
     * that the copy works.
     */
    @Test
    @DisplayName("the migration unwraps quoted strings and flattens objects and arrays into one line")
    void legacyJsonShapes_convertToReadableText() throws Exception {
        String conversionFn;
        try (var in = getClass().getResourceAsStream(
                "/db/changelog/v1.0.0/021-branch-address-jsonb-to-text-fn.sql")) {
            assertThat(in).describedAs("the changeset's own SQL is on the test classpath").isNotNull();
            conversionFn = new String(in.readAllBytes(), StandardCharsets.UTF_8);
        }

        Map<Integer, String> expected = new LinkedHashMap<>();
        expected.put(1, "12 Khayaban-e-Iqbal");        // the quote-mark workaround, now unwrapped
        expected.put(2, "12 Zamzama, Karachi");        // object, in postal order not storage order
        expected.put(3, "12 Zamzama, Karachi");        // array
        expected.put(4, null);                          // never set
        expected.put(5, "9 Mall Road, Lahore, Pakistan"); // object with a non-string member dropped
        expected.put(6, null);                          // {}
        expected.put(7, null);                          // a string of spaces is not an address

        try (Connection c = asOwner(); Statement s = c.createStatement()) {
            s.execute("DROP TABLE IF EXISTS branch_address_migration_fixture");
            s.execute("CREATE TABLE branch_address_migration_fixture (id int, address jsonb)");
            s.execute("""
                    INSERT INTO branch_address_migration_fixture VALUES
                      (1, '"12 Khayaban-e-Iqbal"'::jsonb),
                      (2, '{"city": "Karachi", "line1": "12 Zamzama"}'::jsonb),
                      (3, '["12 Zamzama","Karachi"]'::jsonb),
                      (4, NULL),
                      (5, '{"lat": 24.8, "city": "Lahore", "line1": "9 Mall Road", "country": "Pakistan"}'::jsonb),
                      (6, '{}'::jsonb),
                      (7, '"   "'::jsonb)
                    """);
            s.execute(conversionFn);
            s.execute("""
                    ALTER TABLE branch_address_migration_fixture
                        ALTER COLUMN address TYPE text
                        USING branch_address_jsonb_to_text(address)
                    """);
            s.execute("DROP FUNCTION branch_address_jsonb_to_text(jsonb)");

            Map<Integer, String> actual = new LinkedHashMap<>();
            try (ResultSet rs = s.executeQuery(
                    "SELECT id, address FROM branch_address_migration_fixture ORDER BY id")) {
                while (rs.next()) {
                    actual.put(rs.getInt(1), rs.getString(2));
                }
            }
            s.execute("DROP TABLE branch_address_migration_fixture");

            assertThat(actual).containsExactlyInAnyOrderEntriesOf(expected);
            // The point of the whole item, stated as its own assertion: no quote marks survive.
            assertThat(actual.get(1)).doesNotContain("\"");
        }
    }

    // ══ Helpers ══════════════════════════════════════════════════════════════════════════════

    private static String branchPath(UUID branchId) {
        return "/api/v1/branches/" + branchId;
    }

    /** The value a separate GET hands back — the read the settings form actually repopulates from. */
    private String storedAddress(UUID branchId) throws Exception {
        ResponseEntity<String> read = getAs(adminToken(), branchPath(branchId));
        assertThat(read.getStatusCode().value()).isEqualTo(200);
        JsonNode address = JSON.readTree(read.getBody()).path("data").path("address");
        return address.isNull() ? null : address.asText();
    }

    private UUID createBranch(UUID tenantId, String name) {
        setRls(tenantId);
        ResponseEntity<String> created = postWithHeader("/internal/users/branches",
                new LinkedHashMap<>(Map.of("tenantId", tenantId.toString(), "name", name, "isHq", false)),
                UserInternalServiceFilter.HEADER, INTERNAL_SECRET);
        assertThat(created.getStatusCode().value()).isEqualTo(201);
        try {
            return UUID.fromString(JSON.readTree(created.getBody()).path("branchId").asText());
        } catch (Exception e) {
            throw new IllegalStateException("could not read branchId from " + created.getBody(), e);
        }
    }

    private String adminToken() {
        return Jwts.builder()
                .header().keyId(KID).and()
                .subject(ADMIN_ID.toString())
                .claim("tenant_id", TENANT_A.toString())
                .claim("roles", List.of("TENANT_ADMIN"))
                .claim("permissions", BRANCH_ADMIN_PERMISSIONS)
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
}
