package io.restaurantos.shared.money;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.restaurantos.shared.print.ReceiptMoneyFormatter;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;

import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * D-37-05, applied to the smallest thing in the product: the rule that turns an integer paisa
 * value into the string a human acts on.
 *
 * <h2>Why a JSON file and not literals in this class</h2>
 *
 * <p>{@code money-display-vectors.json} is read by TWO test suites in two languages — this one,
 * off the shared-lib test classpath, and {@code frontend/__tests__/lib/money-display-authority.test.ts},
 * off a relative import. It is deliberately owned by neither. Before this phase the JVM rendered
 * 123456 paisa as a whole-rupee figure and the browser rendered it with the minor unit, and
 * nothing failed, because each stack tested itself against its own expectations. A shared arbiter
 * is what makes that impossible: change the rule on one side and the other side goes red.
 *
 * <p>The vectors' {@code paisa} is a JSON <em>string</em>. A bare JSON number is parsed into an
 * IEEE-754 double by most parsers, which destroys the 2^53 vector at exactly the point it exists
 * to be asserted.
 */
class MoneyDisplayAuthorityTest {

    /** Resolved from the test classpath, never from a filesystem path — see {@link #vectorFileIsLoadedFromTheClasspath()}. */
    static final String VECTOR_RESOURCE = "/money-display-vectors.json";

    record Vector(String name, long paisa, String display) {}

    private static List<Vector> vectors;

    @BeforeAll
    static void loadVectors() throws Exception {
        try (InputStream in = MoneyDisplayAuthorityTest.class.getResourceAsStream(VECTOR_RESOURCE)) {
            assertNotNull(in, VECTOR_RESOURCE + " must be on the shared-lib test classpath");
            JsonNode root = new ObjectMapper().readTree(in);
            List<Vector> parsed = new ArrayList<>();
            for (JsonNode node : root.get("vectors")) {
                parsed.add(new Vector(
                        node.get("name").asText(),
                        Long.parseLong(node.get("paisa").asText()),
                        node.get("display").asText()));
            }
            assertTrue(parsed.size() >= 8, "the arbiter must carry the full vector set, found " + parsed.size());
            vectors = parsed;
        }
    }

    // ── Behaviour 1: a non-zero minor unit is not rounded away by the JVM renderer ────────────
    @Test
    void nonZeroMinorUnitSurvivesTheJvmRenderer() {
        assertEquals("Rs 1,234.56", MoneyUtils.formatPkr(123_456L));
        assertEquals("Rs 1,234.56", MoneyUtils.toMoney(123_456L).formatted());
    }

    // ── Behaviour 2: zero renders two decimal places, not a bare zero ─────────────────────────
    @Test
    void zeroRendersTwoDecimalPlaces() {
        assertEquals("Rs 0.00", MoneyUtils.formatPkr(0L));
    }

    // ── Behaviour 3: a negative amount signs ahead of the prefix and keeps two places ─────────
    @Test
    void negativeAmountSignsAheadOfThePrefix() {
        String rendered = MoneyUtils.formatPkr(-50_000L);
        assertEquals("-Rs 500.00", rendered);
        assertTrue(rendered.startsWith("-"), "the sign leads; a receipt is not a trial balance");
        assertFalse(rendered.contains("("), "accounting parentheses have no place on a customer-facing amount");
    }

    // ── Behaviour 4: a value beyond 2^53 paisa renders EXACTLY — no double is on the path ─────
    @Test
    void valueBeyondTwoToTheFiftyThreeRendersExactly() {
        // 2^53 + 1. A double cannot hold this; if one is on the path the last digit moves.
        assertEquals("Rs 90,071,992,547,409.93", MoneyUtils.formatPkr(9_007_199_254_740_993L));
        assertEquals(9_007_199_254_740_993L, ReceiptMoneyFormatter.parse(MoneyUtils.formatPkr(9_007_199_254_740_993L)));
    }

    // ── Behaviour 5: every vector in the shared file renders exactly what the file records ────
    @Test
    void everyVectorRendersItsRecordedString() {
        for (Vector v : vectors) {
            assertEquals(v.display(), MoneyUtils.formatPkr(v.paisa()),
                    "vector '" + v.name() + "' (" + v.paisa() + " paisa)");
        }
    }

    // ── Behaviour 6: the two JVM renderers agree on every vector ──────────────────────────────
    @Test
    void bothJvmRenderersAgreeOnEveryVector() {
        for (Vector v : vectors) {
            assertEquals(ReceiptMoneyFormatter.format(v.paisa()), MoneyUtils.formatPkr(v.paisa()),
                    "the print authority and the shared formatter disagree on '" + v.name() + "'");
        }
    }

    // ── The structural guarantees the behaviours rest on ──────────────────────────────────────

    /**
     * A locale lookup is the non-determinism {@code ReceiptMoneyFormatter}'s javadoc argues
     * against: a German-locale JVM in one branch would swap the decimal and grouping separators.
     * Leaving the machinery in place as dead code invites its reuse, so it is asserted absent.
     */
    @Test
    void moneyUtilsCarriesNoLocaleSensitiveFormattingMachinery() throws Exception {
        Path source = Path.of("src/main/java/io/restaurantos/shared/money/MoneyUtils.java");
        assertTrue(Files.exists(source), "expected MoneyUtils source at " + source.toAbsolutePath());
        String body = Files.readString(source, StandardCharsets.UTF_8);
        assertFalse(body.contains("NumberFormat"), "MoneyUtils must not reference NumberFormat");
        assertFalse(body.contains("Locale"), "MoneyUtils must not reference Locale");
        assertFalse(body.contains("FractionDigits"), "MoneyUtils must not configure fraction digits");
    }

    /** Loaded by resource lookup so the frontend and the JVM can share one file, not two copies. */
    @Test
    void vectorFileIsLoadedFromTheClasspath() {
        assertNotNull(getClass().getResource(VECTOR_RESOURCE));
    }
}
