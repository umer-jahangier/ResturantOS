package io.restaurantos.finance.autopost;

import io.restaurantos.finance.dto.CreateJeLineRequest;
import io.restaurantos.finance.dto.InternalAutoPostJeRequest;
import io.restaurantos.finance.dto.InternalJePostResponse;
import io.restaurantos.finance.service.JournalEntryService;
import io.restaurantos.shared.event.EventEnvelope;
import io.restaurantos.shared.event.payload.InventoryEventContract;
import io.restaurantos.shared.event.payload.PosEventContract;
import io.restaurantos.shared.tenant.TenantContext;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import java.util.UUID;

/**
 * Turns domain events into balanced journal entries.
 *
 * <p><b>Typed payloads, not maps.</b> Every recipe used to take a
 * {@code Map<String, Object>} and reach for string keys, with a {@code longVal} helper that
 * returned {@code 0} for a missing key. Two of those keys had never existed on the wire —
 * {@code lines[].variancePaisa} (published as {@code varianceCostPaisa}) and
 * {@code lines[].costPaisa} (published as {@code unitCostPaisa}, with no line total at all) — so
 * stock-count variances and inter-branch transfers were consumed, acked, marked processed, and
 * posted nothing. Silently, for months, with a green test suite: the ITs hand-authored their
 * payloads using the consumer's own guessed names. The recipes now take the shared contract
 * records, so a producer rename is a compile error here.
 *
 * <p><b>Tagged accounts, not hardcoded codes.</b> Recipes resolve every account through
 * {@link AccountResolver} by {@code system_tag}. The previous literals were wrong on their own
 * terms: count gains credited 5221 "Delivery Cost", loyalty redemptions debited 2400 "Accrued
 * Liabilities" (which nothing ever credited, so the liability was never recognised), and refunds
 * shared 4920 "Discounts Given" with genuine discounts. V8 adds the missing accounts and a partial
 * unique index so a tag can never again resolve to two of them.
 */
@Service
@Transactional
public class AutoPostingRecipeEngine {

    static final String SOURCE_ORDER_REVENUE = "ORDER_REVENUE";
    static final String SOURCE_ORDER_COGS = "ORDER_COGS";
    static final String SOURCE_ORDER_REFUND = "ORDER_REFUND";
    static final String SOURCE_WASTAGE = "WASTAGE";
    static final String SOURCE_COUNT_VARIANCE = "COUNT_VARIANCE";
    static final String SOURCE_TRANSFER_SHIP = "TRANSFER_SHIP";
    static final String SOURCE_TRANSFER_RECV = "TRANSFER_RECV";
    static final String SOURCE_STOCK_RECEIPT = "STOCK_RECEIPT";
    static final String SOURCE_PAYROLL_APPROVED = "PAYROLL_APPROVED";
    static final String SOURCE_PAYROLL_PAID = "PAYROLL_PAID";

    private final AccountResolver accountResolver;
    private final JournalEntryService jeService;
    private final PostedSourceEventRepository postedSourceRepo;
    private final TenantContext tenantContext;

    public AutoPostingRecipeEngine(AccountResolver accountResolver,
                                   JournalEntryService jeService,
                                   PostedSourceEventRepository postedSourceRepo,
                                   TenantContext tenantContext) {
        this.accountResolver = accountResolver;
        this.jeService = jeService;
        this.postedSourceRepo = postedSourceRepo;
        this.tenantContext = tenantContext;
    }

    // ── Order revenue ───────────────────────────────────────────────────────
    /**
     * DR each tender (cash/bank/loyalty/voucher) · CR net revenue, service charge and output tax,
     * DR discount.
     *
     * <p>The entry balances because {@code sum(payments[].amountPaisa) == totalPaisa} and
     * {@code totalPaisa == subtotal - discount + tax + serviceCharge}. pos-service guarantees the
     * first by capping every payment at the outstanding balance — an over-tender is recorded as
     * change against the drawer, not as revenue. Before that cap, a Rs 50 over-tender on a
     * Rs 1,243 bill produced {@code DR=129300 CR=124300}, the deferred balance trigger rejected
     * the entry, and the message was redelivered ~17 times a second indefinitely.
     *
     * <p>{@code serviceChargePaisa} is credited to its own revenue account. It has always been
     * part of {@code totalPaisa} and was never credited here, which would have made every
     * service-charged order unbalanceable the moment the field became settable.
     */
    public void postOrderRevenue(EventEnvelope<PosEventContract.OrderClosedPayload> envelope) {
        PosEventContract.OrderClosedPayload p = envelope.payload();
        if (alreadyPosted(SOURCE_ORDER_REVENUE, p.orderId())) {
            return;
        }

        long netRevenue = p.subtotalPaisa() - p.discountPaisa();

        List<CreateJeLineRequest> lines = new ArrayList<>();
        addPaymentDebits(p, lines);

        if (p.discountPaisa() > 0) {
            lines.add(line(tag("DISCOUNT"), "Discount", p.discountPaisa(), 0));
        }
        if (netRevenue > 0) {
            lines.add(line(tag("REVENUE"), "Sales revenue", 0, netRevenue));
        }
        if (p.serviceChargePaisa() > 0) {
            lines.add(line(tag("SERVICE_CHARGE"), "Service charge", 0, p.serviceChargePaisa()));
        }
        if (p.taxPaisa() > 0) {
            lines.add(line(tag("OUTPUT_TAX"), "Output tax", 0, p.taxPaisa()));
        }

        post(SOURCE_ORDER_REVENUE, p.orderId(), envelope, "Order revenue " + p.orderId(), lines,
                p.businessDate());
    }

    // ── Order COGS ──────────────────────────────────────────────────────────
    /**
     * DR cost of goods sold · CR inventory, at the aggregate moving-average cost inventory sent.
     *
     * <p>Posts per GL account rather than one aggregate pair. Each depleted line carries the cost
     * and inventory accounts its ingredient's CATEGORY names — resolved by inventory-service,
     * which owns the taxonomy — so a tenant that mapped Beverages to 5200 and Packaging to 5210
     * sees those numbers on those accounts. Phase 08.2 built that mapping, with a validating
     * finance proxy and a management screen, and nothing had ever read it: every COGS entry landed
     * on the single tenant-wide {@code COGS} tag.
     *
     * <p>Lines with no mapping fall back to the tenant-wide tags, so a partially-mapped chart
     * posts correctly rather than failing. Grouping keeps the entry proportional to the number of
     * distinct accounts, not the number of ingredients — a 40-ingredient order still posts a
     * two-line entry when everything shares one cost centre.
     */
    public void postOrderCogs(EventEnvelope<InventoryEventContract.StockDepletedPayload> envelope) {
        InventoryEventContract.StockDepletedPayload p = envelope.payload();
        if (alreadyPosted(SOURCE_ORDER_COGS, p.orderId())) {
            return;
        }
        if (p.totalCogsPaisa() <= 0) {
            return;
        }

        String defaultCogs = tag("COGS");
        String defaultInventory = tag("INVENTORY");

        // Sorted so the journal lines come out in a stable order run to run — an entry whose line
        // order shuffles between replays is needlessly hard to diff.
        Map<AccountPair, Long> byAccounts = new TreeMap<>();
        if (p.lines() == null || p.lines().isEmpty()) {
            byAccounts.put(new AccountPair(defaultCogs, defaultInventory), p.totalCogsPaisa());
        } else {
            for (InventoryEventContract.DepletedLine line : p.lines()) {
                AccountPair key = new AccountPair(
                        line.cogsAccountCode() != null ? line.cogsAccountCode() : defaultCogs,
                        line.inventoryAccountCode() != null ? line.inventoryAccountCode() : defaultInventory);
                byAccounts.merge(key, line.cogsPaisa(), Long::sum);
            }
        }

        List<CreateJeLineRequest> lines = new ArrayList<>();
        long posted = 0L;
        for (Map.Entry<AccountPair, Long> entry : byAccounts.entrySet()) {
            long amount = entry.getValue();
            if (amount <= 0) {
                continue;
            }
            lines.add(line(entry.getKey().cogsCode(), "COGS", amount, 0));
            lines.add(line(entry.getKey().inventoryCode(), "Inventory", 0, amount));
            posted += amount;
        }

        // The per-line costs must reconcile to the header the producer computed. A mismatch means
        // the two were derived differently, which is exactly the class of drift the shared payload
        // contract exists to prevent — so it fails loudly rather than posting a plausible number.
        if (posted != p.totalCogsPaisa()) {
            throw new IllegalStateException(
                    "STOCK_DEPLETED line costs sum to " + posted + " but totalCogsPaisa is "
                            + p.totalCogsPaisa() + " for order " + p.orderId());
        }
        if (lines.isEmpty()) {
            return;
        }

        post(SOURCE_ORDER_COGS, p.orderId(), envelope, "Order COGS " + p.orderId(), lines);
    }

    /** Groups COGS lines by the (cost, inventory) account pair they post against. */
    private record AccountPair(String cogsCode, String inventoryCode) implements Comparable<AccountPair> {
        @Override
        public int compareTo(AccountPair other) {
            int byCogs = cogsCode.compareTo(other.cogsCode);
            return byCogs != 0 ? byCogs : inventoryCode.compareTo(other.inventoryCode);
        }
    }

    // ── Order refund ────────────────────────────────────────────────────────
    /**
     * DR sales refunds and output tax · CR cash.
     *
     * <p>The tax split rides on the event: pos-service knows the original order's tax basis and
     * apportions it, because finance sees only the refund. Reversing the tax is what keeps Phase
     * 12's FBR Tax Summary (output tax − input tax) honest — without it every refund left the
     * liability overstated by its tax component.
     *
     * <p>COGS is deliberately NOT reversed. Refunding a meal does not un-consume the ingredients;
     * the food is gone either way. A wastage entry is the right instrument if the stock is
     * genuinely written off.
     */
    public void postOrderRefund(EventEnvelope<PosEventContract.OrderRefundedPayload> envelope) {
        PosEventContract.OrderRefundedPayload p = envelope.payload();
        if (alreadyPosted(SOURCE_ORDER_REFUND, p.orderId())) {
            return;
        }
        if (p.refundPaisa() <= 0) {
            return;
        }

        long taxPortion = Math.max(0, Math.min(p.taxPaisa(), p.refundPaisa()));
        long revenuePortion = p.refundPaisa() - taxPortion;

        List<CreateJeLineRequest> lines = new ArrayList<>();
        if (revenuePortion > 0) {
            lines.add(line(tag("SALES_REFUND"), "Sales refund", revenuePortion, 0));
        }
        if (taxPortion > 0) {
            lines.add(line(tag("OUTPUT_TAX"), "Output tax reversal", taxPortion, 0));
        }
        lines.add(line(tag("CASH"), "Cash refund", 0, p.refundPaisa()));

        post(SOURCE_ORDER_REFUND, p.orderId(), envelope, "Order refund " + p.orderId(), lines);
    }

    // ── Stock receipt ───────────────────────────────────────────────────────
    /**
     * DR inventory · CR GR/IR clearing.
     *
     * <p>Consumes inventory's own STOCK_RECEIVED, so a receipt is ledger-visible however it was
     * entered — the manual stock screen or a purchase-order goods receipt. GR/IR is then cleared
     * by the vendor invoice, which is the whole point of the clearing account.
     */
    public void postStockReceipt(EventEnvelope<InventoryEventContract.StockReceivedPayload> envelope) {
        InventoryEventContract.StockReceivedPayload p = envelope.payload();
        // Keyed on the lot: one receipt, one lot, one entry — and it is the only id the payload
        // carries that is unique per receipt.
        if (alreadyPosted(SOURCE_STOCK_RECEIPT, p.lotId())) {
            return;
        }
        if (p.totalCostPaisa() <= 0) {
            return;
        }

        List<CreateJeLineRequest> lines = List.of(
                line(tag("INVENTORY"), "Stock received", p.totalCostPaisa(), 0),
                line(tag("GR_IR"), "GR/IR clearing", 0, p.totalCostPaisa()));

        post(SOURCE_STOCK_RECEIPT, p.lotId(), envelope, "Stock receipt " + p.lotId(), lines);
    }

    // ── Wastage ─────────────────────────────────────────────────────────────
    /** DR waste &amp; spoilage · CR inventory. */
    public void postWastage(EventEnvelope<InventoryEventContract.WastageRecordedPayload> envelope) {
        InventoryEventContract.WastageRecordedPayload p = envelope.payload();
        if (alreadyPosted(SOURCE_WASTAGE, p.wastageId())) {
            return;
        }
        if (p.costPaisa() <= 0) {
            return;
        }

        List<CreateJeLineRequest> lines = List.of(
                line(tag("WASTAGE"), "Wastage", p.costPaisa(), 0),
                line(tag("INVENTORY"), "Inventory", 0, p.costPaisa()));

        post(SOURCE_WASTAGE, p.wastageId(), envelope, "Wastage " + p.wastageId(), lines);
    }

    // ── Stock-count variance ────────────────────────────────────────────────
    /**
     * A loss: DR count loss · CR inventory. A gain: DR inventory · CR count gain.
     *
     * <p>Lines are netted into a single debit/credit pair per direction rather than one pair per
     * ingredient — a 200-line count would otherwise produce a 400-line journal entry, and the
     * ingredient-level detail already lives in {@code inventory_movements}.
     */
    public void postCountVariance(EventEnvelope<InventoryEventContract.CountVariancePostedPayload> envelope) {
        InventoryEventContract.CountVariancePostedPayload p = envelope.payload();
        if (alreadyPosted(SOURCE_COUNT_VARIANCE, p.countId())) {
            return;
        }
        if (p.lines() == null || p.lines().isEmpty()) {
            return;
        }

        long lossPaisa = 0;
        long gainPaisa = 0;
        for (InventoryEventContract.CountVarianceLine cl : p.lines()) {
            if (cl.varianceCostPaisa() < 0) {
                lossPaisa += Math.abs(cl.varianceCostPaisa());
            } else {
                gainPaisa += cl.varianceCostPaisa();
            }
        }

        List<CreateJeLineRequest> lines = new ArrayList<>();
        if (lossPaisa > 0) {
            lines.add(line(tag("COUNT_LOSS"), "Count loss", lossPaisa, 0));
            lines.add(line(tag("INVENTORY"), "Inventory reduction", 0, lossPaisa));
        }
        if (gainPaisa > 0) {
            lines.add(line(tag("INVENTORY"), "Inventory increase", gainPaisa, 0));
            lines.add(line(tag("COUNT_GAIN"), "Count gain", 0, gainPaisa));
        }
        if (lines.isEmpty()) {
            return;
        }

        post(SOURCE_COUNT_VARIANCE, p.countId(), envelope, "Count variance " + p.countId(), lines);
    }

    // ── Inter-branch transfer ───────────────────────────────────────────────
    /** DR goods in transit · CR inventory, at the branch that shipped. */
    public void postTransferShipped(EventEnvelope<InventoryEventContract.TransferShippedPayload> envelope) {
        InventoryEventContract.TransferShippedPayload p = envelope.payload();
        if (alreadyPosted(SOURCE_TRANSFER_SHIP, p.transferId())) {
            return;
        }
        long totalCost = sumLineCost(p.lines());
        if (totalCost <= 0) {
            return;
        }

        List<CreateJeLineRequest> lines = List.of(
                line(tag("INVENTORY_TRANSIT"), "Goods in transit", totalCost, 0),
                line(tag("INVENTORY"), "Inventory shipped", 0, totalCost));

        post(SOURCE_TRANSFER_SHIP, p.transferId(), envelope, "Transfer shipped " + p.transferId(), lines);
    }

    /** DR inventory · CR goods in transit, at the branch that received. */
    public void postTransferReceived(EventEnvelope<InventoryEventContract.TransferReceivedPayload> envelope) {
        InventoryEventContract.TransferReceivedPayload p = envelope.payload();
        if (alreadyPosted(SOURCE_TRANSFER_RECV, p.transferId())) {
            return;
        }
        long totalCost = sumLineCost(p.lines());
        if (totalCost <= 0) {
            return;
        }

        List<CreateJeLineRequest> lines = List.of(
                line(tag("INVENTORY"), "Inventory received", totalCost, 0),
                line(tag("INVENTORY_TRANSIT"), "Clear transit", 0, totalCost));

        post(SOURCE_TRANSFER_RECV, p.transferId(), envelope, "Transfer received " + p.transferId(), lines);
    }

    // ── Internals ───────────────────────────────────────────────────────────

    private static long sumLineCost(List<InventoryEventContract.TransferLine> lines) {
        if (lines == null) {
            return 0L;
        }
        // lineCostPaisa is computed by inventory-service with its own HALF_UP rounding. Never
        // re-derive it from qty * unitCostPaisa here: the rounding rule belongs to the domain that
        // owns the quantity.
        return lines.stream().mapToLong(InventoryEventContract.TransferLine::lineCostPaisa).sum();
    }

    // ── Payroll (HR-03 consumer side) ───────────────────────────────────────
    /** PAYROLL_RUN_APPROVED -> DR 6200 Salary expense · CR 2300 Wages payable, for the gross. */
    public void postPayrollApproved(EventEnvelope<Map<String, Object>> envelope) {
        Map<String, Object> p = envelope.payload();
        UUID runId = uuid(p, "runId");
        if (runId == null || alreadyPosted(SOURCE_PAYROLL_APPROVED, runId)) {
            return;
        }
        long grossPaisa = longVal(p, "totalGrossPaisa");
        if (grossPaisa <= 0) {
            return;
        }
        List<CreateJeLineRequest> lines = List.of(
                line("6200", "Salary expense", grossPaisa, 0),
                line("2300", "Wages payable", 0, grossPaisa));
        post(SOURCE_PAYROLL_APPROVED, runId, envelope, "Payroll approved " + runId, lines);
    }

    /** PAYROLL_RUN_PAID -> DR 2300 Wages payable · CR Bank, for the net disbursed. */
    public void postPayrollPaid(EventEnvelope<Map<String, Object>> envelope) {
        Map<String, Object> p = envelope.payload();
        UUID runId = uuid(p, "runId");
        if (runId == null || alreadyPosted(SOURCE_PAYROLL_PAID, runId)) {
            return;
        }
        long netPaisa = longVal(p, "totalNetPaisa");
        if (netPaisa <= 0) {
            return;
        }
        List<CreateJeLineRequest> lines = List.of(
                line("2300", "Wages payable", netPaisa, 0),
                line(tag("BANK"), "Payroll disbursement", 0, netPaisa));
        post(SOURCE_PAYROLL_PAID, runId, envelope, "Payroll paid " + runId, lines);
    }

    private static UUID uuid(Map<String, Object> payload, String key) {
        Object v = payload.get(key);
        return v == null ? null : UUID.fromString(v.toString());
    }

    private static long longVal(Map<String, Object> payload, String key) {
        Object v = payload.get(key);
        if (v instanceof Number n) {
            return n.longValue();
        }
        return v == null ? 0L : Long.parseLong(v.toString());
    }

    private void post(String sourceType, UUID sourceId, EventEnvelope<?> envelope,
                      String description, List<CreateJeLineRequest> lines) {
        post(sourceType, sourceId, envelope, description, lines, null);
    }

    /**
     * {@code businessDate} is the producer's own answer for which trading day this belongs to.
     * When it is present the entry uses it verbatim; otherwise the entry falls back to the
     * envelope's publish timestamp, which is what every recipe used to do — and which is why an
     * order could be period-checked against one day and posted to another.
     */
    private void post(String sourceType, UUID sourceId, EventEnvelope<?> envelope,
                      String description, List<CreateJeLineRequest> lines, LocalDate businessDate) {
        UUID tenantId = tenantContext.requireTenantId();
        UUID branchId = envelope.branchId() != null
                ? envelope.branchId()
                : tenantContext.getBranchId().orElseThrow(() -> new IllegalStateException("branchId required"));

        LocalDate entryDate = businessDate != null
                ? businessDate
                : envelope.occurredAt() != null
                        ? envelope.occurredAt().atZone(ZoneOffset.UTC).toLocalDate()
                        : LocalDate.now();

        InternalAutoPostJeRequest req = new InternalAutoPostJeRequest(
                branchId, entryDate, description, sourceType, sourceId, lines);

        InternalJePostResponse response = jeService.autoPostInternal(req);

        PostedSourceEventEntity row = new PostedSourceEventEntity();
        row.setTenantId(tenantId);
        row.setSourceType(sourceType);
        row.setSourceId(sourceId);
        row.setJeId(response.jeId());
        row.setPostedAt(Instant.now());
        postedSourceRepo.save(row);
    }

    /**
     * One debit per tender, routed to the account that tender actually lands in.
     *
     * <p>The method switch previously listed a "WALLET" method that pos-service's
     * {@code PaymentMethod} enum has never had, while BANK_TRANSFER and VOUCHER fell through to
     * the default and debited Cash in Hand — so a bank transfer inflated the cash drawer in the
     * ledger and a voucher was booked as cash received.
     */
    private void addPaymentDebits(PosEventContract.OrderClosedPayload payload, List<CreateJeLineRequest> lines) {
        if (payload.payments() == null || payload.payments().isEmpty()) {
            // Defensive: an order cannot close unpaid (maybeCloseOrder requires PaymentStatus.PAID),
            // so this only guards a hand-crafted or replayed event.
            lines.add(line(tag("CASH"), "Cash", payload.totalPaisa(), 0));
            return;
        }

        for (PosEventContract.PaymentEntry payment : payload.payments()) {
            if (payment.amountPaisa() <= 0) {
                continue;
            }
            String method = payment.method() != null ? payment.method() : "CASH";
            String accountTag = switch (method) {
                case "CARD", "BANK_TRANSFER" -> "BANK";
                case "LOYALTY_POINTS" -> "LOYALTY_LIABILITY";
                case "VOUCHER" -> "VOUCHER_LIABILITY";
                default -> "CASH";
            };
            lines.add(line(tag(accountTag), method + " payment", payment.amountPaisa(), 0));
        }
    }

    private String tag(String systemTag) {
        return accountResolver.codeBySystemTag(systemTag);
    }

    private boolean alreadyPosted(String sourceType, UUID sourceId) {
        return postedSourceRepo.existsByTenantIdAndSourceTypeAndSourceId(
                tenantContext.requireTenantId(), sourceType, sourceId);
    }

    private static CreateJeLineRequest line(String code, String desc, long debit, long credit) {
        return new CreateJeLineRequest(code, desc, debit, credit);
    }
}
