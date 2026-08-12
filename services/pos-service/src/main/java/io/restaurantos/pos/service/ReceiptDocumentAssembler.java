package io.restaurantos.pos.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.restaurantos.pos.domain.enums.OrderItemStatus;
import io.restaurantos.pos.domain.model.MenuItem;
import io.restaurantos.pos.domain.model.PrintJob;
import io.restaurantos.pos.dto.OrderDto;
import io.restaurantos.pos.dto.OrderPaymentDto;
import io.restaurantos.pos.feign.UserBranchClient;
import io.restaurantos.pos.repository.MenuItemRepository;
import io.restaurantos.shared.print.PrintDocument;
import io.restaurantos.shared.print.ReceiptAmount;
import io.restaurantos.shared.tenant.TenantContext;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

/**
 * Turns a persisted order into the paper a customer keeps.
 *
 * <h2>Every printed figure is read from the database</h2>
 *
 * <p>The caller names an order id. Nothing else. No total, no line price, no tender and no customer
 * identity is accepted from a request body, because a receipt assembled from client-supplied money
 * is a forgery surface — and because the receipt has to agree with the ledger, which was written
 * from these same rows.
 *
 * <h2>No arithmetic on displayed money</h2>
 *
 * <p>Every amount is a persisted paisa integer handed to {@code ReceiptAmount.of}, which calls the
 * one formatter D-26-04 names. Nothing here divides by a hundred. GA-007 records a screen that did
 * that arithmetic in the wrong place and rendered every total one hundred times too large; a
 * receipt is the same defect with the customer holding the evidence.
 *
 * <h2>It refuses to produce a receipt that does not add up</h2>
 *
 * <p>Two integer identities are checked before the document is returned, and a failure throws
 * rather than returning a document. A receipt that disagrees with the order is worse than an error
 * a cashier can report, because the error is visible and the disagreement is not — until a customer
 * finds it.
 *
 * <h2>A settings lookup never blocks a settlement</h2>
 *
 * <p>The user-service call is fail-SOFT in exactly one direction: an unreachable service, an
 * unconfigured branch or an unreadable configuration degrades the document (no drawer kick, no cut
 * instruction) and never fails it. D-26-01 and definition-of-done item 6: a tenant with no printer
 * must still get a bill. The degradation is written onto the footer so a support engineer reading
 * a reprint six weeks later can tell why the drawer did not open.
 */
@Service
public class ReceiptDocumentAssembler {

    private static final Logger log = LoggerFactory.getLogger(ReceiptDocumentAssembler.class);

    /** Printed on the paper when the printer configuration could not be read. */
    static final String CONFIG_UNAVAILABLE_NOTE =
            "Printer configuration unavailable - drawer and cut not commanded";
    /** Printed when the branch simply has no printer configured. Not an error; D-26-01. */
    static final String NO_PRINTER_NOTE =
            "No printer configured for this branch - browser bill";

    private final OrderService orderService;
    private final PaymentService paymentService;
    private final MenuItemRepository menuItemRepository;
    private final UserBranchClient userBranchClient;
    private final TenantContext tenantContext;
    private final ObjectMapper objectMapper;

    public ReceiptDocumentAssembler(OrderService orderService,
                                    PaymentService paymentService,
                                    MenuItemRepository menuItemRepository,
                                    UserBranchClient userBranchClient,
                                    TenantContext tenantContext,
                                    ObjectMapper objectMapper) {
        this.orderService = orderService;
        this.paymentService = paymentService;
        this.menuItemRepository = menuItemRepository;
        this.userBranchClient = userBranchClient;
        this.tenantContext = tenantContext;
        this.objectMapper = objectMapper;
    }

    /**
     * The document plus the printer it is addressed to.
     *
     * <p>The target travels beside the document rather than inside it because it is ROUTING, not
     * content: {@code PrintDocument} declares no printer-model or destination field at all
     * (26-01), and the target is half of {@code print_jobs}' sequence key.
     */
    public record Assembled(PrintDocument document, String targetPrinterId) {}

    @Transactional(readOnly = true)
    public Assembled assembleReceipt(UUID orderId, UUID branchId) {
        UUID tenantId = tenantContext.requireTenantId();
        OrderDto order = orderService.getOrder(orderId, branchId);
        List<OrderPaymentDto> payments = paymentService.listPayments(orderId);

        BranchConfiguration branch = readBranchConfiguration(branchId, tenantId);

        List<OrderDto.OrderItemDto> billable = order.items().stream()
                .filter(item -> item.kdsStatus() != OrderItemStatus.CANCELLED)
                .toList();

        assertMoneyIdentities(order, billable);

        List<PrintDocument.Line> lines = billable.stream().map(this::toLine).toList();
        List<PrintDocument.TaxLine> taxBreakdown = buildTaxBreakdown(billable, order.taxPaisa(), tenantId);
        List<PrintDocument.Tender> tenders = payments.stream().map(this::toTender).toList();

        boolean anyCash = payments.stream().anyMatch(p -> "CASH".equalsIgnoreCase(p.method()));
        PrintDocument.Drawer drawer = drawerFor(branch, anyCash);
        PrintDocument.Cut cut = new PrintDocument.Cut(branch.cutMode());

        PrintDocument document = new PrintDocument(
                PrintDocument.SCHEMA_VERSION,
                PrintDocument.DocumentType.CUSTOMER_RECEIPT,
                PrintDocument.Provenance.SERVER,
                tenantId,
                branchId,
                orderId,
                order.orderNo(),
                // Placeholder issue metadata. PrintJobService re-stamps this with the real
                // sequence when it writes the row; the assembler cannot know it, because
                // allocating it is a write and this method is read-only.
                new PrintDocument.Issue(1L, false, Instant.now(), null),
                branch.header(),
                // No kitchen routing block on a customer receipt — the compact constructor refuses
                // one, and this is the only assembler that builds receipts.
                null,
                lines,
                new PrintDocument.Totals(
                        ReceiptAmount.of(order.subtotalPaisa()),
                        ReceiptAmount.of(order.discountPaisa()),
                        ReceiptAmount.of(order.serviceChargePaisa()),
                        // F20. Both null when the branch takes no service charge, which is what
                        // lets the renderers omit the row entirely instead of printing
                        // "Service charge Rs 0.00" — the line that appeared on every bill this
                        // product ever produced, for a charge no restaurant could set.
                        serviceChargeLabelOf(order),
                        serviceChargeRateOf(order),
                        ReceiptAmount.of(order.taxPaisa()),
                        ReceiptAmount.of(order.totalPaisa())),
                taxBreakdown,
                tenders,
                // D-26-03: the region is DECLARED and left entirely null. Phase 27 owns FBR and
                // will populate these fields; it will not redesign this document.
                new PrintDocument.Fiscal(null, null, null, null, null),
                drawer,
                cut,
                new PrintDocument.Footer(branch.footerLines()));

        assertEveryAmountReParses(document);
        return new Assembled(document, branch.targetPrinterId());
    }

    // ── The two identities, asserted here and not only in a test ─────────────────────────────

    /**
     * The same two invariants {@code OrderPricingCalculator.aggregateOrderTotals} establishes and
     * {@code ORDER_CLOSED} carries to finance. Stated in the shape this codebase actually computes
     * rather than the shape a receipt is usually described in:
     *
     * <ol>
     *   <li>{@code subtotal} is GROSS — before line discounts and before tax — so it equals
     *       {@code Σ(lineTotal + lineDiscount − lineTax)}, not {@code Σ lineTotal}; and</li>
     *   <li>{@code subtotal − discount + tax + serviceCharge == total}.</li>
     * </ol>
     *
     * <p>If either fails, the printed paper would disagree with the order row and therefore with
     * the journal entry finance posted from it. That is worth an exception.
     */
    private void assertMoneyIdentities(OrderDto order, List<OrderDto.OrderItemDto> billable) {
        long lineTotals = billable.stream().mapToLong(OrderDto.OrderItemDto::lineTotalPaisa).sum();
        long lineDiscounts = billable.stream().mapToLong(OrderDto.OrderItemDto::discountPaisa).sum();
        long lineTaxes = billable.stream().mapToLong(OrderDto.OrderItemDto::taxPaisa).sum();

        long derivedSubtotal = lineTotals + lineDiscounts - lineTaxes;
        if (derivedSubtotal != order.subtotalPaisa()) {
            throw new IllegalStateException(
                    "Refusing to print order " + order.id() + ": the billable lines derive a subtotal of "
                            + derivedSubtotal + " paisa but the order row says " + order.subtotalPaisa()
                            + ". The paper would disagree with the ledger.");
        }
        if (lineTaxes != order.taxPaisa()) {
            throw new IllegalStateException(
                    "Refusing to print order " + order.id() + ": the billable lines carry " + lineTaxes
                            + " paisa of tax but the order row says " + order.taxPaisa() + ".");
        }

        long derivedTotal = order.subtotalPaisa() - order.discountPaisa()
                + order.taxPaisa() + order.serviceChargePaisa();
        if (derivedTotal != order.totalPaisa()) {
            throw new IllegalStateException(
                    "Refusing to print order " + order.id() + ": subtotal - discount + tax + service "
                            + "charge is " + derivedTotal + " paisa but the order total is "
                            + order.totalPaisa() + ".");
        }
    }

    /**
     * Every rendered string on the document re-parses to its own paisa field.
     *
     * <p>The same assertion the frontend's zod refinement makes at the boundary — made here first,
     * so a hundredfold error never leaves this service in the first place.
     */
    private void assertEveryAmountReParses(PrintDocument document) {
        List<ReceiptAmount> amounts = new ArrayList<>();
        document.lines().forEach(l -> {
            amounts.add(l.unitPrice());
            amounts.add(l.lineTotal());
        });
        PrintDocument.Totals t = document.totals();
        amounts.add(t.subtotal());
        amounts.add(t.discount());
        amounts.add(t.serviceCharge());
        amounts.add(t.tax());
        amounts.add(t.grandTotal());
        document.taxBreakdown().forEach(tl -> amounts.add(tl.amount()));
        document.tenders().forEach(tender -> {
            amounts.add(tender.amountApplied());
            amounts.add(tender.tip());
            amounts.add(tender.amountTendered());
            amounts.add(tender.change());
        });

        for (ReceiptAmount amount : amounts) {
            long reparsed = io.restaurantos.shared.print.ReceiptMoneyFormatter.parse(amount.formatted());
            if (reparsed != amount.paisa()) {
                throw new IllegalStateException(
                        "Refusing to print: the amount \"" + amount.formatted() + "\" re-parses to "
                                + reparsed + " paisa but carries " + amount.paisa() + ".");
            }
        }
    }

    // ── Mapping ──────────────────────────────────────────────────────────────────────────────

    private PrintDocument.Line toLine(OrderDto.OrderItemDto item) {
        List<String> modifiers = item.modifiers() == null ? List.of()
                : item.modifiers().stream().map(OrderDto.ModifierDto::modifierNameSnapshot).toList();
        return new PrintDocument.Line(
                item.itemNameSnapshot(),
                item.quantity(),
                ReceiptAmount.of(item.unitPriceSnapshot()),
                ReceiptAmount.of(item.lineTotalPaisa()),
                modifiers,
                item.notes(),
                item.kdsStation());
    }

    private PrintDocument.Tender toTender(OrderPaymentDto payment) {
        return new PrintDocument.Tender(
                payment.method(),
                ReceiptAmount.of(payment.amountPaisa()),
                ReceiptAmount.of(payment.tipPaisa()),
                ReceiptAmount.of(payment.tenderedPaisa()),
                ReceiptAmount.of(payment.changePaisa()),
                payment.referenceNo());
    }

    /**
     * The branch's wording for its service charge, or null when there was none (F20).
     *
     * <p>Null — rather than a fallback to the word "Service charge" — is load-bearing. It is the
     * ONLY thing that tells a renderer "this bill has no service charge on it" apart from an
     * amount that happens to be zero, and the two must be told apart: a 5% charge on a fully
     * comped check is genuinely Rs 0.00 and should still say so.
     */
    private static String serviceChargeLabelOf(OrderDto order) {
        if (order.serviceChargeLabel() == null || order.serviceChargeLabel().isBlank()) {
            return null;
        }
        return order.serviceChargeLabel();
    }

    /**
     * The rate as a printable string, or null. A string for the reason every rate on this document
     * is one: it is printed, never computed with, and {@code toPlainString} is the only rendering
     * that cannot introduce an exponent or a lost trailing zero.
     */
    private static String serviceChargeRateOf(OrderDto order) {
        java.math.BigDecimal pct = order.serviceChargePct();
        if (pct == null || pct.signum() <= 0 || serviceChargeLabelOf(order) == null) {
            return null;
        }
        return pct.toPlainString();
    }

    /**
     * What a guest's bill calls tax, on every breakdown line.
     *
     * <p>NOT the rate code. {@code SR-STD-17} is a LEDGER classification: it means something to an
     * accountant reconciling a return and nothing at all to the person holding the paper. This
     * method used to hand the code straight through as the label, and a real bill printed
     * {@code SR-STD-17 (17.00%) [SR-STD-17]} — the internal code twice on one line, wrapping onto
     * a second line of an 80 mm roll. The {@code "OTHER"} → {@code "Tax"} mapping that was here
     * rescued only the UNCLASSIFIED case, which is why the defect was read as an {@code [OTHER]}
     * problem when every classified item was worse.
     *
     * <p>It is the FALLBACK now, not the label (D-4). The screen that holds the per-class display
     * name does exist — {@code /app/settings/tax} captions its Name field, on every rate row, with
     * exactly <em>"Printed on the guest's bill."</em> — and {@code order_items.tax_class_name} has
     * snapshotted that name since F16. This assembler ignored it and printed this phrase over the
     * top, so a tenant who typed a name into a box that promised it would be printed did not get
     * it printed. Worse, the tenant measured on 2026-08-12 had fourteen named classes, SEVEN of
     * them at exactly 17%: a check carrying two different 17% taxes printed two identical lines
     * with nothing to tell them apart.
     *
     * <p>This phrase is now used only where there genuinely is no name — a line taxed by the
     * item's own legacy rate columns, which belong to no class, and pre-F16 lines whose class was
     * never recorded. In those cases the percentage is what distinguishes one rate from another
     * for the person paying, and inventing a name would put a phrase on a guest's bill that
     * nobody in the building ever typed.
     */
    private static final String GUEST_TAX_LABEL = "Sales Tax";

    /**
     * The bucket a taxed line lands in when its menu item carries no rate code of its own.
     *
     * <p>A sentinel this assembler invents, never a code a tenant typed and never a tax anyone
     * charges. It stays on the document as the bucket's machine identity and is never printed.
     */
    private static final String UNCLASSIFIED_RATE_CODE = "OTHER";

    /**
     * A breakdown bucket: one rate code AT one rate.
     *
     * <p>Keyed on both halves deliberately. Keyed on the code alone, two items sharing a code but
     * carrying different percentages — trivially reachable, since the menu form lets a rate be
     * edited without touching the code, and universally so for the unclassified {@code OTHER}
     * bucket — collapsed into one line that stated the FIRST rate against the SUM of both. That
     * prints a percentage which produces no amount on the bill. It was survivable only while the
     * line looked odd enough to distrust; once the label became a plain phrase it would have read
     * as authoritative, so the two changes belong together.
     */
    private record TaxBucket(String rateCode, String ratePercent, String className) {}

    /**
     * Tax grouped by the rate code and rate THE LINE WAS CHARGED AT, with any residue attributed
     * to an unclassified line so the breakdown ALWAYS sums to the order's tax exactly. A breakdown
     * that does not add up to the printed tax total is the same defect class as a total that does
     * not add up to the lines.
     *
     * <h2>F16 — this reads the line's own snapshot, not the live menu row</h2>
     *
     * <p>It used to load {@code menu_items} at PRINT time and take the rate and code from there.
     * That is the wrong row: a bill is a statement of what the guest was charged, and the menu is a
     * statement of what the next guest will be charged. Reprint a three-week-old receipt after a
     * rate change and the paper attributed the old money to the new rate; re-classify a dish and
     * its historical tax silently moved into a bucket it had never paid into. Neither would show up
     * as an error — the amounts still summed, against the wrong headings.
     *
     * <p>Lines written BEFORE F16 carry {@code taxRatePct == 0} with real tax on them, which is
     * impossible for a new line (the tax is computed FROM the rate). Those, and only those, fall
     * back to the live menu row — the behaviour they have always had, so no existing bill in any
     * tenant changes the day this ships. New lines never take that path.
     */
    private List<PrintDocument.TaxLine> buildTaxBreakdown(List<OrderDto.OrderItemDto> billable,
                                                          long orderTaxPaisa,
                                                          UUID tenantId) {
        Map<TaxBucket, long[]> byBucket = new LinkedHashMap<>();

        for (OrderDto.OrderItemDto item : billable) {
            if (item.taxPaisa() == 0L) {
                continue;
            }
            String code;
            String rate;
            // D-4: the tenant's own name for this tax, snapshotted onto the line at add-item time
            // (F16) and until now thrown away at print time. Null for a line taxed by the item's
            // legacy rate columns, which belong to no class — see GUEST_TAX_LABEL.
            String className = item.taxClassName() != null && !item.taxClassName().isBlank()
                    ? item.taxClassName()
                    : null;
            boolean snapshotted = item.taxRatePct() != null && item.taxRatePct().signum() != 0;
            if (snapshotted) {
                code = item.taxRateCode() != null && !item.taxRateCode().isBlank()
                        ? item.taxRateCode()
                        : UNCLASSIFIED_RATE_CODE;
                rate = item.taxRatePct().toPlainString();
            } else {
                // Pre-F16 line. Looked up one item at a time through the tenant-predicated finder
                // rather than findAllById: orders have single-digit line counts, and 26-CONTEXT
                // wants the tenant in the query rather than only in the policy.
                Optional<MenuItem> menuItem =
                        menuItemRepository.findByIdAndTenantId(item.menuItemId(), tenantId);
                code = menuItem.map(MenuItem::getTaxRateCode).filter(c -> c != null && !c.isBlank())
                        .orElse(UNCLASSIFIED_RATE_CODE);
                rate = menuItem.map(m -> m.getTaxRatePct() == null ? null : m.getTaxRatePct().toPlainString())
                        .orElse(null);
                // A pre-F16 line's class was never recorded, so there is no name to print. Do not
                // reach for the live menu row's class: that is a statement about what the NEXT
                // guest is charged, and using it here is the same defect F16 removed for the rate.
                className = null;
            }
            // Keyed on the NAME as well as the code and the rate (D-4). The measured tenant had
            // seven classes at 17%; collapsing them by rate would print one line summing taxes the
            // guest was charged under different headings.
            byBucket.computeIfAbsent(new TaxBucket(code, rate, className), k -> new long[1])[0]
                    += item.taxPaisa();
        }

        long accounted = byBucket.values().stream().mapToLong(v -> v[0]).sum();
        if (accounted != orderTaxPaisa) {
            // Cannot happen while assertMoneyIdentities holds, but if a future change makes the
            // order's tax and its lines' tax diverge, the paper stays internally consistent and
            // the difference is visible rather than silently absorbed. The residue gets its OWN
            // bucket carrying no percentage: it is unattributable by definition, so it must not
            // borrow a rate from a line it did not come from.
            byBucket.computeIfAbsent(new TaxBucket(UNCLASSIFIED_RATE_CODE, null, null),
                    k -> new long[1])[0] += (orderTaxPaisa - accounted);
        }

        List<PrintDocument.TaxLine> out = new ArrayList<>();
        byBucket.forEach((bucket, sum) -> out.add(new PrintDocument.TaxLine(
                bucket.rateCode(),
                bucket.className() != null ? bucket.className() : GUEST_TAX_LABEL,
                bucket.ratePercent(),
                ReceiptAmount.of(sum[0]))));
        return out;
    }

    // ── Branch identity and printer configuration, read fail-soft ────────────────────────────

    /** What the branch lookup produced, degraded or not. */
    private record BranchConfiguration(PrintDocument.Header header,
                                       List<String> footerLines,
                                       String targetPrinterId,
                                       PrintDocument.CutMode cutMode,
                                       Integer drawerPin,
                                       Integer drawerPulseMs) {}

    private BranchConfiguration readBranchConfiguration(UUID branchId, UUID tenantId) {
        UserBranchClient.BranchDetail detail;
        try {
            detail = userBranchClient.getBranch(branchId, tenantId);
        } catch (Exception e) {
            // Fail-SOFT. A cashier holding a customer's money must not be blocked by a settings
            // lookup. The receipt loses its header and its drawer kick, and says so on the paper.
            log.warn("branch {} lookup failed while assembling a receipt; degrading the document: {}",
                    branchId, e.toString());
            return degraded(null, CONFIG_UNAVAILABLE_NOTE);
        }
        if (detail == null) {
            log.warn("branch {} lookup returned nothing while assembling a receipt", branchId);
            return degraded(null, CONFIG_UNAVAILABLE_NOTE);
        }

        PrintDocument.Header header = new PrintDocument.Header(
                detail.name(),
                addressLines(detail.address()),
                detail.phone(),
                detail.ntn(),
                detail.fbrStrn(),
                null);

        JsonNode receiptPrinter = firstReceiptPrinter(detail.receiptConfig());
        if (receiptPrinter == null) {
            // Not an error: a branch with no thermal hardware is a supported branch (D-26-01).
            return degraded(header, NO_PRINTER_NOTE);
        }

        String targetId = receiptPrinter.path("id").asText(PrintJob.UNASSIGNED_TARGET);
        PrintDocument.CutMode cut = parseCutMode(receiptPrinter.path("cut").asText(null));
        Integer pin = receiptPrinter.path("drawerPin").isNumber()
                ? receiptPrinter.path("drawerPin").asInt() : null;
        Integer pulse = receiptPrinter.path("drawerPulseMs").isNumber()
                ? receiptPrinter.path("drawerPulseMs").asInt() : null;

        return new BranchConfiguration(header, List.of(), targetId, cut, pin, pulse);
    }

    private static BranchConfiguration degraded(PrintDocument.Header header, String note) {
        return new BranchConfiguration(
                header,
                List.of(note),
                PrintJob.UNASSIGNED_TARGET,
                // NONE, not PARTIAL: commanding a cut on a printer whose configuration we could
                // not read is a guess about hardware. The conservative instruction is to leave the
                // paper attached and let a human tear it.
                PrintDocument.CutMode.NONE,
                null,
                null);
    }

    private PrintDocument.Drawer drawerFor(BranchConfiguration branch, boolean anyCashTender) {
        if (!anyCashTender || branch.drawerPin() == null) {
            // A card-only order does not open the till, and neither does a branch whose printer
            // has no drawer wired to it.
            return null;
        }
        return new PrintDocument.Drawer(true, branch.drawerPin(), branch.drawerPulseMs());
    }

    /** The first RECEIPT-role entry in the branch's printer registry, or null. */
    private JsonNode firstReceiptPrinter(String receiptConfigJson) {
        if (receiptConfigJson == null || receiptConfigJson.isBlank()) {
            return null;
        }
        try {
            JsonNode printers = objectMapper.readTree(receiptConfigJson).path("printers");
            for (JsonNode printer : printers) {
                if ("RECEIPT".equals(printer.path("role").asText())) {
                    return printer;
                }
            }
        } catch (Exception e) {
            log.warn("branch printer registry is unreadable; degrading the document: {}", e.toString());
        }
        return null;
    }

    private static PrintDocument.CutMode parseCutMode(String raw) {
        if (raw == null) {
            return PrintDocument.CutMode.NONE;
        }
        try {
            return PrintDocument.CutMode.valueOf(raw);
        } catch (IllegalArgumentException e) {
            return PrintDocument.CutMode.NONE;
        }
    }

    /**
     * The branch's address, as the lines to print.
     *
     * <p>S4: this used to parse the value as JSON, because {@code branches.address} was a jsonb
     * column. It is TEXT as of user-service changeset 021, and parsing plain text as JSON silently
     * DELETED any address beginning with a digit — see {@link BranchAddressLines}, which owns the
     * behaviour and the test that proves it.
     */
    private List<String> addressLines(String address) {
        return BranchAddressLines.of(address);
    }
}
