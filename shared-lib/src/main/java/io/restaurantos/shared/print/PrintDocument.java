package io.restaurantos.shared.print;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.Objects;
import java.util.UUID;

/**
 * THE one printable document in this product. The customer receipt and the kitchen ticket are two
 * VALUES of this schema, not two schemas.
 *
 * <h2>Why a semantic tree and not bytes</h2>
 *
 * <p>Per the printing research, decision 1: the browser never emits bytes, it POSTs a document.
 * Only the per-branch print agent renders. So this record declares no byte array, no escape
 * sequence, no column count, no codepage and no printer model. Those are the agent's configuration
 * — putting them here would force printer-model knowledge into every client and then again into
 * the server, and "the Urdu codepage is wrong on the Bixolon" would have three places to be fixed.
 * A grep gate on this file asserts no command-language literal creeps back in.
 *
 * <h2>Money</h2>
 *
 * <p>Every money component is a {@link ReceiptAmount}: the integer paisa AND the string already
 * rendered from it by {@link ReceiptMoneyFormatter}. No component of this record is a
 * floating-point type. A renderer prints {@code ReceiptAmount.formatted()} verbatim and does no
 * arithmetic — D-26-04.
 *
 * <h2>The fiscal region</h2>
 *
 * <p>{@link Fiscal} is declared here, entirely nullable, before FBR integration exists (D-26-03).
 * Phase 27 will populate fields; it will not redesign a document. The cost of reserving it now is
 * a nullable record and some whitespace on the paper; the cost of not reserving it is a receipt
 * redesign after tenants have been handed the old layout.
 *
 * <h2>The kitchen-ticket restriction</h2>
 *
 * <p>The compact constructor REJECTS a {@link DocumentType#KITCHEN_TICKET} that carries totals, a
 * tax breakdown, tenders, a fiscal region or a drawer instruction. A kitchen ticket that prints
 * what the customer paid is a privacy defect, not a cosmetic one, and a kitchen printer that opens
 * the till drawer is worse. Enforcing it at construction means an assembler cannot get this wrong
 * quietly.
 *
 * @param schemaVersion the wire version; required
 * @param type          receipt or kitchen ticket; required
 * @param provenance    produced by the server or by an offline client; required
 * @param tenantId      required — an issued document with no identity cannot be reconciled
 * @param branchId      required
 * @param orderId       required
 * @param orderNo       the human-readable order number printed on the paper
 * @param issue         sequence, reprint flag and timestamps; required
 * @param header        branch identity block
 * @param ticket        the kitchen routing block; MUST be null on a customer receipt
 * @param lines         the ordered lines; never null, may be empty only on a voided document
 * @param totals        null on a kitchen ticket
 * @param taxBreakdown  empty on a kitchen ticket
 * @param tenders       empty on a kitchen ticket
 * @param fiscal        null when no fiscal data exists yet, and always null on a kitchen ticket
 * @param drawer        null on a kitchen ticket
 * @param cut           required — every document ends somewhere
 * @param footer        trailing lines
 */
public record PrintDocument(
        String schemaVersion,
        DocumentType type,
        Provenance provenance,
        UUID tenantId,
        UUID branchId,
        UUID orderId,
        String orderNo,
        Issue issue,
        Header header,
        Ticket ticket,
        List<Line> lines,
        Totals totals,
        List<TaxLine> taxBreakdown,
        List<Tender> tenders,
        Fiscal fiscal,
        Drawer drawer,
        Cut cut,
        Footer footer
) {

    /** The wire version of this schema. Bump on any breaking shape change. */
    public static final String SCHEMA_VERSION = "1.0";

    public PrintDocument {
        Objects.requireNonNull(schemaVersion, "schemaVersion is required");
        Objects.requireNonNull(type, "type is required");
        Objects.requireNonNull(provenance, "provenance is required");
        Objects.requireNonNull(tenantId, "tenantId is required");
        Objects.requireNonNull(branchId, "branchId is required");
        Objects.requireNonNull(orderId, "orderId is required");
        Objects.requireNonNull(issue, "issue is required");
        Objects.requireNonNull(cut, "cut is required");

        lines = lines == null ? List.of() : List.copyOf(lines);
        taxBreakdown = taxBreakdown == null ? List.of() : List.copyOf(taxBreakdown);
        tenders = tenders == null ? List.of() : List.copyOf(tenders);

        if (type == DocumentType.KITCHEN_TICKET) {
            reject(totals != null, "totals");
            reject(!taxBreakdown.isEmpty(), "a tax breakdown");
            reject(!tenders.isEmpty(), "tenders");
            reject(fiscal != null, "a fiscal region");
            reject(drawer != null, "a drawer instruction");
        } else if (ticket != null) {
            // The symmetric restriction, added in 26-07. A CUSTOMER_RECEIPT carrying a kitchen
            // routing block would print the station, the cover count and the server's identity on
            // the paper a customer walks out with. Less severe than the reverse, but it is the
            // same class of mistake and it costs one branch to refuse it here.
            throw new IllegalArgumentException(
                    "a CUSTOMER_RECEIPT must not carry a kitchen ticket block — the station, the "
                            + "cover count and the server's identity are back-of-house routing, not "
                            + "something a customer is handed");
        }
    }

    private static void reject(boolean populated, String what) {
        if (populated) {
            throw new IllegalArgumentException(
                    "a KITCHEN_TICKET must not carry " + what
                            + " — the kitchen does not see what the customer paid, and a kitchen "
                            + "printer does not open the till");
        }
    }

    /** Two values of one schema. */
    public enum DocumentType { CUSTOMER_RECEIPT, KITCHEN_TICKET }

    /**
     * Who produced this document. The cloud produces the authoritative fiscal receipt because it
     * is the only thing that can hold the FBR invoice number; the tab produces a provisional one
     * when the WAN is down, and a renderer bands that copy visibly.
     */
    public enum Provenance { SERVER, CLIENT_OFFLINE }

    /**
     * @param sequenceNumber the per-branch issue sequence printed on the paper
     * @param reprint        true when this is not the first issue of this document
     * @param issuedAt       when THIS issue was produced; required
     * @param originalIssuedAt when the FIRST issue was produced; required if and only if
     *                         {@code reprint} — a reprint that cannot say what it is a reprint of
     *                         is indistinguishable from an original, which is the whole point of
     *                         the flag
     */
    public record Issue(long sequenceNumber, boolean reprint, Instant issuedAt, Instant originalIssuedAt) {
        public Issue {
            Objects.requireNonNull(issuedAt, "issuedAt is required");
            if (reprint && originalIssuedAt == null) {
                throw new IllegalArgumentException(
                        "a reprint must carry the original issue timestamp so the paper is "
                                + "distinguishable from the first issue");
            }
        }
    }

    /**
     * @param logoFileId the file-service id of the branch logo; the document names an asset, never
     *                   raster data
     */
    public record Header(
            String branchName,
            List<String> addressLines,
            String phone,
            String ntn,
            String strn,
            UUID logoFileId
    ) {
        public Header {
            addressLines = addressLines == null ? List.of() : List.copyOf(addressLines);
        }
    }

    /**
     * The kitchen routing block (26-07). Null on a customer receipt, and refused there by the
     * compact constructor.
     *
     * <p><b>Why this is not squeezed into {@link Header}.</b> Header is the branch identity block —
     * name, address, phone, NTN. A chef needs a different five things, and putting "Table 12" into
     * {@code addressLines} would work exactly once, until somebody reads the field name and
     * believes it.
     *
     * <p>Every field is nullable because every one of them is genuinely absent on some real order:
     * a takeaway has no table, a walk-in has no cover count, and an item whose menu row carries no
     * station lands on {@code stationCode} {@code "UNASSIGNED"} rather than vanishing.
     *
     * <p>Nullable ON A KITCHEN TICKET TOO — deliberately not required. 26-04's renderer tests and
     * 26-06's queue fixtures construct kitchen tickets with no routing block, and forcing one on
     * them would be a schema change dressed up as a guarantee. What IS guaranteed is the direction
     * that matters: a receipt can never carry one.
     *
     * @param stationCode  the station this ticket is for; the assembler's
     *                     {@code UNASSIGNED} sentinel when the line carries no station
     * @param stationName  the human name from the station catalogue, when one resolves
     * @param orderTypeLabel DINE_IN / TAKEAWAY / … — a chef plates differently for each
     * @param tableLabel   the table number as printed, never the table's UUID
     * @param coverCount   how many people are eating, null when unknown
     * @param revisionNo   which fire this is; a chef seeing revision 3 knows two tickets preceded it
     * @param firedAt      when the line was fired, which is what a pass times against
     * @param serverName   the server's display name when one is known
     * @param serverRef    the cashier/server id. Carried because {@code serverName} is NOT
     *                     populated by 26-07 — pos-service has no user-name lookup and adding one
     *                     is a user-service change this plan does not make. A renderer prints the
     *                     name when it has one and a short form of this reference otherwise, which
     *                     at least matches against a shift roster. Logged as deferred item D-7.
     * @param orderInstructions order-level notes; these appear on EVERY station's ticket, because
     *                     "no nuts on this table" applies to the whole order and not to one pass
     */
    public record Ticket(
            String stationCode,
            String stationName,
            String orderTypeLabel,
            String tableLabel,
            Integer coverCount,
            Integer revisionNo,
            Instant firedAt,
            String serverName,
            UUID serverRef,
            List<String> orderInstructions
    ) {
        public Ticket {
            orderInstructions = orderInstructions == null ? List.of() : List.copyOf(orderInstructions);
        }
    }

    /**
     * @param modifiers human-readable modifier descriptions, already resolved; a renderer prints
     *                  them, it does not look them up
     * @param stationCode the KDS station this line belongs to — the only field a kitchen ticket
     *                    routes on
     */
    public record Line(
            String name,
            int quantity,
            ReceiptAmount unitPrice,
            ReceiptAmount lineTotal,
            List<String> modifiers,
            String note,
            String stationCode
    ) {
        public Line {
            modifiers = modifiers == null ? List.of() : List.copyOf(modifiers);
        }
    }

    /**
     * {@code subtotal - discount + serviceCharge + tax == grandTotal}, asserted in the tests.
     *
     * <p>{@code serviceChargeLabel} and {@code serviceChargeRatePercent} (F20) are the branch's own
     * wording and the rate the check was charged at, snapshotted onto the order. Both are null when
     * the branch takes no service charge, and a renderer must then print NO service-charge row at
     * all — {@code Service charge Rs 0.00} appeared on every bill this product ever produced, for a
     * charge no restaurant could set.
     *
     * <p>{@code serviceCharge} itself stays non-null and stays in the arithmetic, because the
     * invariant above is what the assembler and the print-agent both check before printing. Zero is
     * a true amount; the decision not to SAY it belongs to the renderer.
     *
     * @param serviceChargeRatePercent the rate as a STRING, e.g. {@code "5.00"} — never a
     *                                 floating-point type, for the reason {@link TaxLine} gives
     */
    public record Totals(
            ReceiptAmount subtotal,
            ReceiptAmount discount,
            ReceiptAmount serviceCharge,
            String serviceChargeLabel,
            String serviceChargeRatePercent,
            ReceiptAmount tax,
            ReceiptAmount grandTotal
    ) {
        /** The pre-F20 shape: an unnamed, un-rated service charge. Kept source-compatible. */
        public Totals(ReceiptAmount subtotal, ReceiptAmount discount, ReceiptAmount serviceCharge,
                      ReceiptAmount tax, ReceiptAmount grandTotal) {
            this(subtotal, discount, serviceCharge, null, null, tax, grandTotal);
        }
    }

    /**
     * @param ratePercent the rate as a STRING, e.g. {@code "16.00"} — never a floating-point type.
     *                    It is printed, not computed with; the amount is already resolved.
     */
    public record TaxLine(String rateCode, String label, String ratePercent, ReceiptAmount amount) {}

    /**
     * @param amountApplied  the amount applied to the bill — this is what settles the total
     * @param tip            money taken ON TOP of the bill for the staff (F20). Never part of
     *                       {@code amountApplied} and never part of the grand total; it is the
     *                       difference the guest sees between the bill and what left their card.
     *                       Zero on almost every tender, and a renderer prints nothing for zero
     * @param amountTendered what the customer handed over — {@code amountApplied + tip + change}.
     *                       Equal to {@code amountApplied} for an untipped card
     * @param change         what came back out of the drawer
     */
    public record Tender(
            String method,
            ReceiptAmount amountApplied,
            ReceiptAmount tip,
            ReceiptAmount amountTendered,
            ReceiptAmount change,
            String referenceNo
    ) {
        /** The pre-F20 shape: an untipped tender. Kept source-compatible. */
        public Tender(String method, ReceiptAmount amountApplied, ReceiptAmount amountTendered,
                      ReceiptAmount change, String referenceNo) {
            this(method, amountApplied, ReceiptAmount.of(0L), amountTendered, change, referenceNo);
        }
    }

    /**
     * The FBR region (D-26-03). EVERY field is nullable and stays that way until Phase 27 fills
     * them; an absent fiscal field is a null in a declared record, never a missing record.
     *
     * @param fbrInvoiceNumber the number the authority assigns; unknowable before it responds
     * @param qrPayload        an OPAQUE payload string. The DI specification fixes the symbol
     *                         version (2.0, 25x25) and the physical size and says nothing about
     *                         what the symbol encodes, so this carries a string and the renderer
     *                         rasterises it — the document never carries an image.
     * @param qrSizeMm         the physical size in millimetres, as an exact decimal (the spec's
     *                         1.0 inch is 25.4 mm, which no integer expresses and no binary
     *                         floating-point type represents exactly)
     * @param logoAssetId      the DI logo asset the spec also requires on every invoice
     * @param noticeLine       the customer-facing verification notice
     */
    public record Fiscal(
            String fbrInvoiceNumber,
            String qrPayload,
            BigDecimal qrSizeMm,
            UUID logoAssetId,
            String noticeLine
    ) {}

    /**
     * An INSTRUCTION, not a command sequence: whether to kick, which connector pin, how long the
     * pulse lasts. The agent owns the mapping from this to the wire.
     */
    public record Drawer(boolean kick, Integer connectorPin, Integer pulseMs) {}

    /** An instruction naming a {@link CutMode} from a closed set — never a command sequence. */
    public record Cut(CutMode mode) {
        public Cut {
            Objects.requireNonNull(mode, "cut mode is required; use NONE for a continuous roll");
        }
    }

    /** The closed set of cut behaviours every supported printer can be mapped onto. */
    public enum CutMode { NONE, PARTIAL, FULL }

    public record Footer(List<String> lines) {
        public Footer {
            lines = lines == null ? List.of() : List.copyOf(lines);
        }
    }
}
