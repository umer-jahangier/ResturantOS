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
                lines,
                new PrintDocument.Totals(
                        ReceiptAmount.of(order.subtotalPaisa()),
                        ReceiptAmount.of(order.discountPaisa()),
                        ReceiptAmount.of(order.serviceChargePaisa()),
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
                ReceiptAmount.of(payment.tenderedPaisa()),
                ReceiptAmount.of(payment.changePaisa()),
                payment.referenceNo());
    }

    /**
     * Tax grouped by the menu item's own rate code, with any residue attributed to an OTHER line so
     * the breakdown ALWAYS sums to the order's tax exactly. A breakdown that does not add up to the
     * printed tax total is the same defect class as a total that does not add up to the lines.
     *
     * <p>Looked up one item at a time through the tenant-predicated finder rather than
     * {@code findAllById}: orders have single-digit line counts, and 26-CONTEXT wants the tenant in
     * the query rather than only in the policy.
     */
    private List<PrintDocument.TaxLine> buildTaxBreakdown(List<OrderDto.OrderItemDto> billable,
                                                          long orderTaxPaisa,
                                                          UUID tenantId) {
        Map<String, long[]> byCode = new LinkedHashMap<>();
        Map<String, String> rateByCode = new LinkedHashMap<>();

        for (OrderDto.OrderItemDto item : billable) {
            if (item.taxPaisa() == 0L) {
                continue;
            }
            Optional<MenuItem> menuItem =
                    menuItemRepository.findByIdAndTenantId(item.menuItemId(), tenantId);
            String code = menuItem.map(MenuItem::getTaxRateCode).filter(c -> c != null && !c.isBlank())
                    .orElse("OTHER");
            String rate = menuItem.map(m -> m.getTaxRatePct() == null ? null : m.getTaxRatePct().toPlainString())
                    .orElse(null);
            byCode.computeIfAbsent(code, k -> new long[1])[0] += item.taxPaisa();
            rateByCode.putIfAbsent(code, rate);
        }

        long accounted = byCode.values().stream().mapToLong(v -> v[0]).sum();
        if (accounted != orderTaxPaisa) {
            // Cannot happen while assertMoneyIdentities holds, but if a future change makes the
            // order's tax and its lines' tax diverge, the paper stays internally consistent and
            // the difference is visible rather than silently absorbed.
            byCode.computeIfAbsent("OTHER", k -> new long[1])[0] += (orderTaxPaisa - accounted);
        }

        List<PrintDocument.TaxLine> out = new ArrayList<>();
        byCode.forEach((code, sum) -> out.add(new PrintDocument.TaxLine(
                code,
                "OTHER".equals(code) ? "Tax" : code,
                rateByCode.get(code),
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
     * {@code branches.address} is a jsonb column with no schema this service can rely on — it may
     * be an object, an array or a bare string. Every shape becomes lines; none of them becomes an
     * exception, because a malformed address must not stop a customer getting a bill.
     */
    private List<String> addressLines(String addressJson) {
        if (addressJson == null || addressJson.isBlank()) {
            return List.of();
        }
        try {
            JsonNode node = objectMapper.readTree(addressJson);
            List<String> lines = new ArrayList<>();
            if (node.isTextual()) {
                lines.add(node.asText());
            } else if (node.isArray()) {
                node.forEach(child -> lines.add(child.asText()));
            } else if (node.isObject()) {
                node.properties().forEach(entry -> {
                    if (entry.getValue().isTextual() && !entry.getValue().asText().isBlank()) {
                        lines.add(entry.getValue().asText());
                    }
                });
            }
            return List.copyOf(lines);
        } catch (Exception e) {
            return List.of(addressJson);
        }
    }
}
