package io.restaurantos.shared.print;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import io.restaurantos.shared.config.SharedAutoConfiguration;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * The wire contract for {@link PrintDocument}, and the producer of the ONE golden fixture that the
 * frontend adapter suite, the print agent's renderer suite and this suite are all tested against.
 *
 * <p>The fixture lives at {@code contracts/print/golden-receipt-document.json} at the repository
 * root — deliberately outside every module, because three build systems read it. It is CHECKED IN,
 * not generated at build time; this test asserts the checked-in bytes still describe the document
 * this code produces. Regenerate deliberately with
 * {@code mvn -pl shared-lib test -Dtest=PrintDocumentContractTest -Dprint.fixture.regenerate=true}
 * and read the diff before committing it.
 */
class PrintDocumentContractTest {

    private static final String FIXTURE_RELATIVE_PATH = "contracts/print/golden-receipt-document.json";
    private static final String REGENERATE_PROPERTY = "print.fixture.regenerate";

    /** The project's Jackson configuration, taken from the project rather than re-declared here. */
    private static ObjectMapper mapper() {
        return new SharedAutoConfiguration().sharedObjectMapper();
    }

    /**
     * Regeneration happens ONCE, before any test runs — not inside a test. Four tests read the
     * fixture and JUnit does not promise an order, so a regeneration living inside one of them
     * would pass or fail depending on which ran first.
     */
    @BeforeAll
    static void regenerateFixtureIfAsked() throws IOException {
        if (!Boolean.getBoolean(REGENERATE_PROPERTY)) {
            return;
        }
        Path fixture = repoRoot().resolve(FIXTURE_RELATIVE_PATH);
        Files.createDirectories(fixture.getParent());
        Files.writeString(fixture, renderFixture(), StandardCharsets.UTF_8);
    }

    private static String renderFixture() throws IOException {
        return mapper().copy()
                .enable(SerializationFeature.INDENT_OUTPUT)
                .writeValueAsString(canonicalReceipt()) + "\n";
    }

    // ══ Behaviour 1: the envelope is required, in full ════════════════════════════════════════

    @Test
    void envelopeFieldsAreRequiredNonNull() {
        assertThrows(NullPointerException.class,
                () -> canonicalReceiptBuilder().schemaVersion(null).build(),
                "schema version");
        assertThrows(NullPointerException.class,
                () -> canonicalReceiptBuilder().type(null).build(),
                "document type");
        assertThrows(NullPointerException.class,
                () -> canonicalReceiptBuilder().provenance(null).build(),
                "provenance");
        assertThrows(NullPointerException.class,
                () -> canonicalReceiptBuilder().tenantId(null).build(),
                "tenant id — an issued document with no identity cannot be repudiated against");
        assertThrows(NullPointerException.class,
                () -> canonicalReceiptBuilder().branchId(null).build(), "branch id");
        assertThrows(NullPointerException.class,
                () -> canonicalReceiptBuilder().orderId(null).build(), "order id");
        assertThrows(NullPointerException.class,
                () -> canonicalReceiptBuilder().issue(null).build(), "issue metadata");
        assertThrows(NullPointerException.class,
                () -> new PrintDocument.Issue(1L, false, null, null),
                "issue timestamp");
        assertThrows(NullPointerException.class,
                () -> canonicalReceiptBuilder().cut(null).build(), "cut instruction");
    }

    /** A reprint must be able to say what it is a reprint OF (definition-of-done item 3). */
    @Test
    void aReprintMustCarryTheOriginalIssueTimestamp() {
        assertThrows(IllegalArgumentException.class,
                () -> new PrintDocument.Issue(1042L, true, Instant.parse("2026-08-11T15:00:00Z"), null));

        PrintDocument.Issue reprint = new PrintDocument.Issue(
                1042L, true,
                Instant.parse("2026-08-11T15:00:00Z"),
                Instant.parse("2026-08-11T14:32:07Z"));
        assertTrue(reprint.reprint());
        assertNotNull(reprint.originalIssuedAt());
    }

    // ══ Behaviour 2: a customer receipt carries every region ══════════════════════════════════

    @Test
    void aCustomerReceiptCarriesEveryRegion() {
        PrintDocument doc = canonicalReceipt();

        assertEquals(PrintDocument.DocumentType.CUSTOMER_RECEIPT, doc.type());
        assertNotNull(doc.header());
        assertEquals(3, doc.lines().size());
        assertEquals(3, doc.lines().get(1).quantity());
        assertEquals(36_000L, doc.lines().get(1).lineTotal().paisa());
        assertNotNull(doc.totals());
        assertEquals(2, doc.taxBreakdown().size());
        assertEquals(2, doc.tenders().size());
        assertNotNull(doc.fiscal());
        assertNotNull(doc.drawer());
        assertNotNull(doc.cut());
        assertNotNull(doc.footer());
    }

    /**
     * D-26-04 and definition-of-done item 4: the totals must agree with the lines and with the
     * tenders to the paisa. Asserted on the integers, never on the rendered strings.
     */
    @Test
    void theFixtureTotalsBalanceToThePaisa() {
        PrintDocument doc = canonicalReceipt();

        long lineSum = doc.lines().stream().mapToLong(l -> l.lineTotal().paisa()).sum();
        assertEquals(doc.totals().subtotal().paisa(), lineSum, "lines must sum to the subtotal");

        long taxSum = doc.taxBreakdown().stream().mapToLong(t -> t.amount().paisa()).sum();
        assertEquals(doc.totals().tax().paisa(), taxSum, "the tax breakdown must sum to the tax total");

        long expectedGrand = doc.totals().subtotal().paisa()
                - doc.totals().discount().paisa()
                + doc.totals().serviceCharge().paisa()
                + doc.totals().tax().paisa();
        assertEquals(expectedGrand, doc.totals().grandTotal().paisa(),
                "subtotal - discount + service charge + tax must equal the grand total");

        long applied = doc.tenders().stream().mapToLong(t -> t.amountApplied().paisa()).sum();
        assertEquals(doc.totals().grandTotal().paisa(), applied,
                "the tenders applied must settle the bill exactly");
    }

    // ══ Behaviour 3: a kitchen ticket is REJECTED if it carries customer money ════════════════

    @Test
    void aKitchenTicketCarryingTotalsTendersFiscalOrDrawerIsRejectedAtConstruction() {
        // The clean case constructs.
        PrintDocument ticket = canonicalKitchenTicket();
        assertEquals(PrintDocument.DocumentType.KITCHEN_TICKET, ticket.type());
        assertNull(ticket.totals());
        assertTrue(ticket.tenders().isEmpty());
        assertTrue(ticket.taxBreakdown().isEmpty());
        assertNull(ticket.fiscal());
        assertNull(ticket.drawer());

        PrintDocument receipt = canonicalReceipt();

        assertThrows(IllegalArgumentException.class,
                () -> kitchenTicketBuilder().totals(receipt.totals()).build(),
                "a kitchen ticket must not carry totals");
        assertThrows(IllegalArgumentException.class,
                () -> kitchenTicketBuilder().tenders(receipt.tenders()).build(),
                "a kitchen ticket printing what the customer paid is a privacy defect");
        assertThrows(IllegalArgumentException.class,
                () -> kitchenTicketBuilder().taxBreakdown(receipt.taxBreakdown()).build(),
                "a kitchen ticket must not carry the tax breakdown");
        assertThrows(IllegalArgumentException.class,
                () -> kitchenTicketBuilder().fiscal(receipt.fiscal()).build(),
                "a kitchen ticket must not carry a fiscal region");
        assertThrows(IllegalArgumentException.class,
                () -> kitchenTicketBuilder().drawer(receipt.drawer()).build(),
                "a kitchen printer must not open the cash drawer");
    }

    // ══ Behaviour 4: the fiscal region exists NOW, nullable, before FBR does (D-26-03) ════════

    @Test
    void theFiscalRegionIsDeclaredAndEveryFieldIsNullable() {
        PrintDocument.Fiscal empty = new PrintDocument.Fiscal(null, null, null, null, null);
        assertNull(empty.fbrInvoiceNumber());
        assertNull(empty.qrPayload());
        assertNull(empty.qrSizeMm());
        assertNull(empty.logoAssetId());
        assertNull(empty.noticeLine());

        PrintDocument withoutFiscalData = canonicalReceiptBuilder().fiscal(null).build();
        assertNull(withoutFiscalData.fiscal());

        PrintDocument withEmptyFiscal = canonicalReceiptBuilder().fiscal(empty).build();
        assertNotNull(withEmptyFiscal.fiscal());

        // And the populated one carries the shape Phase 27 will fill: an OPAQUE payload string and
        // a physical size, never a generated image — the DI spec fixes 25x25 version 2.0 at one
        // inch square but does not say what the symbol encodes.
        PrintDocument.Fiscal populated = canonicalReceipt().fiscal();
        assertEquals(new BigDecimal("25.4"), populated.qrSizeMm());
        assertNotNull(populated.qrPayload());
    }

    // ══ Behaviours 5 and 6: drawer and cut are INSTRUCTIONS, not byte sequences ═══════════════

    @Test
    void theDrawerInstructionNamesPinAndPulseAndTheCutInstructionNamesAModeFromAClosedSet() {
        PrintDocument.Drawer drawer = canonicalReceipt().drawer();
        assertTrue(drawer.kick());
        assertEquals(2, drawer.connectorPin());
        assertEquals(100, drawer.pulseMs());

        assertEquals(PrintDocument.CutMode.PARTIAL, canonicalReceipt().cut().mode());
        // A closed set: the renderer maps these to bytes, the document never names one.
        assertEquals(3, PrintDocument.CutMode.values().length);
        assertEquals(
                List.of("NONE", "PARTIAL", "FULL"),
                List.of(PrintDocument.CutMode.values()).stream().map(Enum::name).toList());
    }

    // ══ Behaviour 7: Jackson round-trip ══════════════════════════════════════════════════════

    @Test
    void aFullyPopulatedReceiptRoundTripsThroughTheProjectsJacksonConfiguration() throws Exception {
        ObjectMapper mapper = mapper();
        PrintDocument original = canonicalReceipt();
        String json = mapper.writeValueAsString(original);
        PrintDocument back = mapper.readValue(json, PrintDocument.class);
        assertEquals(original, back);

        PrintDocument ticket = canonicalKitchenTicket();
        assertEquals(ticket, mapper.readValue(mapper.writeValueAsString(ticket), PrintDocument.class));
    }

    // ══ The golden fixture ═══════════════════════════════════════════════════════════════════

    @Test
    void theGoldenFixtureIsCheckedInAndStillDescribesThisDocument() throws Exception {
        ObjectMapper mapper = mapper();
        String rendered = renderFixture();
        Path fixture = repoRoot().resolve(FIXTURE_RELATIVE_PATH);

        assertTrue(Files.exists(fixture),
                "the golden fixture is missing at " + fixture + " — regenerate with -D" + REGENERATE_PROPERTY + "=true");

        String onDisk = Files.readString(fixture, StandardCharsets.UTF_8);
        assertEquals(mapper.readTree(rendered), mapper.readTree(onDisk),
                "the checked-in fixture no longer matches the document this code produces");

        // And it deserialises back into an equal record — the fixture is a document, not a blob.
        assertEquals(canonicalReceipt(), mapper.readValue(onDisk, PrintDocument.class));
    }

    @Test
    void theGoldenFixtureCarriesAFiscalRegionAndANonZeroPaisaRemainder() throws Exception {
        JsonNode tree = mapper().readTree(
                Files.readString(repoRoot().resolve(FIXTURE_RELATIVE_PATH), StandardCharsets.UTF_8));

        assertTrue(tree.hasNonNull("fiscal"), "the fixture must exercise the FBR region");
        assertNotNull(tree.get("fiscal").get("fbrInvoiceNumber").asText());
        assertTrue(tree.get("fiscal").hasNonNull("qrPayload"));

        boolean anyRemainder = false;
        for (JsonNode amount : collectAmounts(tree)) {
            if (amount.get("paisa").asLong() % 100 != 0) {
                anyRemainder = true;
                break;
            }
        }
        assertTrue(anyRemainder,
                "the fixture must contain at least one amount with a non-zero paisa remainder, "
                        + "or it cannot prove the whole-rupee rounding trap is shut");
    }

    /** Every amount in the fixture re-parses to its own paisa value — the 100x guard, on disk. */
    @Test
    void everyAmountInTheGoldenFixtureReParsesToItsOwnPaisaValue() throws Exception {
        JsonNode tree = mapper().readTree(
                Files.readString(repoRoot().resolve(FIXTURE_RELATIVE_PATH), StandardCharsets.UTF_8));

        List<JsonNode> amounts = collectAmounts(tree);
        assertTrue(amounts.size() >= 15, "expected the fixture to exercise many amounts, found " + amounts.size());

        for (JsonNode amount : amounts) {
            long paisa = amount.get("paisa").asLong();
            String formatted = amount.get("formatted").asText();
            assertEquals(paisa, ReceiptMoneyFormatter.parse(formatted),
                    "fixture amount " + formatted + " does not re-parse to its own paisa value " + paisa);
        }
    }

    // ══ Helpers ══════════════════════════════════════════════════════════════════════════════

    /** Every {@code {paisa, formatted}} pair anywhere in the tree. */
    private static List<JsonNode> collectAmounts(JsonNode node) {
        List<JsonNode> found = new ArrayList<>();
        if (node.isObject()) {
            if (node.has("paisa") && node.has("formatted")) {
                found.add(node);
            }
            Iterator<Map.Entry<String, JsonNode>> fields = node.fields();
            while (fields.hasNext()) {
                found.addAll(collectAmounts(fields.next().getValue()));
            }
        } else if (node.isArray()) {
            for (JsonNode child : node) {
                found.addAll(collectAmounts(child));
            }
        }
        return found;
    }

    /**
     * Walk up from the module directory to the repository root. The fixture is at the root by
     * design (three build systems read it), so the path cannot be module-relative.
     */
    private static Path repoRoot() throws IOException {
        Path here = Path.of("").toAbsolutePath();
        for (Path p = here; p != null; p = p.getParent()) {
            if (Files.exists(p.resolve(".git")) || Files.exists(p.resolve(FIXTURE_RELATIVE_PATH))) {
                return p;
            }
        }
        throw new IOException("could not locate the repository root from " + here);
    }

    // ── The canonical document. Every number below is deliberate; see theFixtureTotalsBalance. ──

    private static final UUID TENANT_ID = UUID.fromString("11111111-1111-4111-8111-111111111111");
    private static final UUID BRANCH_ID = UUID.fromString("22222222-2222-4222-8222-222222222222");
    private static final UUID ORDER_ID = UUID.fromString("33333333-3333-4333-8333-333333333333");
    private static final UUID LOGO_FILE_ID = UUID.fromString("44444444-4444-4444-8444-444444444444");
    private static final UUID FBR_LOGO_ID = UUID.fromString("55555555-5555-4555-8555-555555555555");
    private static final Instant ISSUED_AT = Instant.parse("2026-08-11T14:32:07Z");

    static PrintDocument canonicalReceipt() {
        return canonicalReceiptBuilder().build();
    }

    static Builder canonicalReceiptBuilder() {
        Builder b = new Builder();
        b.schemaVersion = PrintDocument.SCHEMA_VERSION;
        b.type = PrintDocument.DocumentType.CUSTOMER_RECEIPT;
        b.provenance = PrintDocument.Provenance.SERVER;
        b.tenantId = TENANT_ID;
        b.branchId = BRANCH_ID;
        b.orderId = ORDER_ID;
        b.orderNo = "FT-2026-0811-1042";
        b.issue = new PrintDocument.Issue(1042L, false, ISSUED_AT, null);
        b.header = new PrintDocument.Header(
                "Floating Terrace",
                List.of("Street 12, F-7 Markaz", "Islamabad, ICT"),
                "+92 51 234 5678",
                "7000007-8",
                "17-00-9999-000-11",
                LOGO_FILE_ID);
        b.lines = List.of(
                new PrintDocument.Line("Chicken Karahi (Full)", 1,
                        ReceiptAmount.of(185_000L), ReceiptAmount.of(185_000L),
                        List.of("Extra spicy"), "Guest is allergic to peanuts", "HOT"),
                new PrintDocument.Line("Garlic Naan", 3,
                        ReceiptAmount.of(12_000L), ReceiptAmount.of(36_000L),
                        List.of(), null, "TANDOOR"),
                // 80.33 x 2 — the non-zero paisa remainder the whole formatter exists for.
                new PrintDocument.Line("Mineral Water 1.5L", 2,
                        ReceiptAmount.of(8_033L), ReceiptAmount.of(16_066L),
                        List.of(), null, "COLD"));
        b.totals = new PrintDocument.Totals(
                ReceiptAmount.of(237_066L),  // 185000 + 36000 + 16066
                ReceiptAmount.of(10_000L),   // discount
                ReceiptAmount.of(22_706L),   // service charge
                ReceiptAmount.of(34_575L),   // tax = 33440 + 1135
                ReceiptAmount.of(284_347L)); // 237066 - 10000 + 22706 + 34575
        b.taxBreakdown = List.of(
                new PrintDocument.TaxLine("GST-16", "Sales Tax", "16.00", ReceiptAmount.of(33_440L)),
                new PrintDocument.TaxLine("ICT-05", "ICT Services", "5.00", ReceiptAmount.of(1_135L)));
        b.tenders = List.of(
                new PrintDocument.Tender("CARD",
                        ReceiptAmount.of(200_000L), ReceiptAmount.of(200_000L), ReceiptAmount.zero(),
                        "VISA-4421"),
                new PrintDocument.Tender("CASH",
                        ReceiptAmount.of(84_347L), ReceiptAmount.of(100_000L), ReceiptAmount.of(15_653L),
                        null));
        b.fiscal = new PrintDocument.Fiscal(
                "7000007DI1747300500123",
                "FBR|7000007DI1747300500123|2026-08-11T14:32:07Z",
                new BigDecimal("25.4"),
                FBR_LOGO_ID,
                "Verify this invoice with the FBR Tax Asaan app.");
        b.drawer = new PrintDocument.Drawer(true, 2, 100);
        b.cut = new PrintDocument.Cut(PrintDocument.CutMode.PARTIAL);
        b.footer = new PrintDocument.Footer(List.of("Thank you — please come again", "www.floatingterrace.pk"));
        return b;
    }

    static PrintDocument canonicalKitchenTicket() {
        return kitchenTicketBuilder().build();
    }

    static Builder kitchenTicketBuilder() {
        Builder b = canonicalReceiptBuilder();
        b.type = PrintDocument.DocumentType.KITCHEN_TICKET;
        b.totals = null;
        b.taxBreakdown = List.of();
        b.tenders = List.of();
        b.fiscal = null;
        b.drawer = null;
        b.cut = new PrintDocument.Cut(PrintDocument.CutMode.FULL);
        b.footer = new PrintDocument.Footer(List.of("*** HOT STATION ***"));
        return b;
    }

    /**
     * A test-local builder. Deliberately NOT shipped on the record: production code constructs a
     * {@code PrintDocument} through the canonical constructor so that every required field is a
     * compile-time obligation. The builder exists only so a test can vary one field at a time.
     */
    static final class Builder {
        String schemaVersion;
        PrintDocument.DocumentType type;
        PrintDocument.Provenance provenance;
        UUID tenantId;
        UUID branchId;
        UUID orderId;
        String orderNo;
        PrintDocument.Issue issue;
        PrintDocument.Header header;
        List<PrintDocument.Line> lines;
        PrintDocument.Totals totals;
        List<PrintDocument.TaxLine> taxBreakdown;
        List<PrintDocument.Tender> tenders;
        PrintDocument.Fiscal fiscal;
        PrintDocument.Drawer drawer;
        PrintDocument.Cut cut;
        PrintDocument.Footer footer;

        Builder schemaVersion(String v) { this.schemaVersion = v; return this; }
        Builder type(PrintDocument.DocumentType v) { this.type = v; return this; }
        Builder provenance(PrintDocument.Provenance v) { this.provenance = v; return this; }
        Builder tenantId(UUID v) { this.tenantId = v; return this; }
        Builder branchId(UUID v) { this.branchId = v; return this; }
        Builder orderId(UUID v) { this.orderId = v; return this; }
        Builder issue(PrintDocument.Issue v) { this.issue = v; return this; }
        Builder totals(PrintDocument.Totals v) { this.totals = v; return this; }
        Builder taxBreakdown(List<PrintDocument.TaxLine> v) { this.taxBreakdown = v; return this; }
        Builder tenders(List<PrintDocument.Tender> v) { this.tenders = v; return this; }
        Builder fiscal(PrintDocument.Fiscal v) { this.fiscal = v; return this; }
        Builder drawer(PrintDocument.Drawer v) { this.drawer = v; return this; }
        Builder cut(PrintDocument.Cut v) { this.cut = v; return this; }

        PrintDocument build() {
            return new PrintDocument(schemaVersion, type, provenance, tenantId, branchId, orderId,
                    orderNo, issue, header, lines, totals, taxBreakdown, tenders, fiscal, drawer,
                    cut, footer);
        }
    }
}
