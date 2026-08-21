package io.restaurantos.finance.autopost;

import io.restaurantos.finance.dto.CreateJeLineRequest;
import io.restaurantos.finance.dto.InternalAutoPostJeRequest;
import io.restaurantos.finance.dto.InternalJePostResponse;
import io.restaurantos.finance.service.JournalEntryService;
import io.restaurantos.shared.event.EventEnvelope;
import io.restaurantos.shared.event.payload.HrEventContract;
import io.restaurantos.shared.event.payload.InventoryEventContract;
import io.restaurantos.shared.event.payload.PosEventContract;
import io.restaurantos.shared.tenant.TenantContext;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
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

    private static final Logger log = LoggerFactory.getLogger(AutoPostingRecipeEngine.class);

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
     * DR each tender (cash/bank/loyalty/voucher) and the discount · CR GROSS revenue, service
     * charge and output tax.
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
     *
     * <p><b>Why revenue is credited GROSS.</b> The discount is already debited to 4920 "Discounts
     * Given" as contra-revenue. Crediting revenue NET as well — {@code subtotal - discount} — books
     * the same discount twice, once on each side, and the entry then fails to balance by exactly
     * {@code discountPaisa}:
     *
     * <pre>
     *   DR  payments        subtotal - discount + tax + serviceCharge
     *   DR  discount        discount
     *   ─────────────────── debits  = subtotal + tax + serviceCharge
     *
     *   CR  revenue (net)   subtotal - discount        ← the double-count
     *   CR  serviceCharge   serviceCharge
     *   CR  outputTax       tax
     *   ─────────────────── credits = subtotal - discount + tax + serviceCharge
     * </pre>
     *
     * <p>Every discounted order therefore tripped {@code JE_UNBALANCED} at commit and posted NO
     * revenue at all — not a partial entry, no entry — while the message requeued. Crediting the
     * gross {@code subtotalPaisa} makes both sides {@code subtotal + tax + serviceCharge} for ANY
     * discount, including a 100% comp (where the tender covers only tax and service charge) and the
     * degenerate discount &gt; subtotal case. It also gives the correct income statement: gross sales
     * on 4100 and the discount visible on 4920, rather than a silently netted figure.
     *
     * <p>Undiscounted orders are untouched by construction: at {@code discount == 0} the old
     * {@code subtotal - discount} and the new {@code subtotal} are the same number and no discount
     * line is emitted. This changes only the orders that previously failed outright.
     *
     * <p><b>Tips (F20) sit OUTSIDE the money invariant, on both sides at once.</b>
     * {@code totalPaisa} is what the guest owed and a tip is not owed, so it cannot appear there;
     * but the money is genuinely in the drawer, so it cannot be left out of the tender debit
     * either. The entry therefore grows by one matched pair — {@code + tip} on the tender's debit,
     * {@code + tip} credited to TIPS_PAYABLE — and balances for exactly the same reason it did
     * before. The tip never reaches 4100: it is the staff's money the restaurant is holding, and
     * booking it as sales would overstate income and tax money the business never earned.
     */
    public void postOrderRevenue(EventEnvelope<PosEventContract.OrderClosedPayload> envelope) {
        PosEventContract.OrderClosedPayload p = envelope.payload();
        if (alreadyPosted(SOURCE_ORDER_REVENUE, p.orderId())) {
            return;
        }

        List<CreateJeLineRequest> lines = new ArrayList<>();
        addPaymentDebits(p, lines);

        if (p.discountPaisa() > 0) {
            lines.add(line(tag("DISCOUNT"), "Discount", p.discountPaisa(), 0));
        }
        // GROSS, not subtotal - discount. See the javadoc: netting here while also debiting the
        // discount counts it twice and unbalances the entry by exactly discountPaisa.
        if (p.subtotalPaisa() > 0) {
            lines.add(line(tag("REVENUE"), "Sales revenue", 0, p.subtotalPaisa()));
        }
        if (p.serviceChargePaisa() > 0) {
            lines.add(line(tag("SERVICE_CHARGE"), "Service charge", 0, p.serviceChargePaisa()));
        }
        if (p.taxPaisa() > 0) {
            lines.add(line(tag("OUTPUT_TAX"), "Output tax", 0, p.taxPaisa()));
        }
        // F20. The tender debits above already include the tip (see addPaymentDebits), because
        // that money is physically in the drawer / on the card slip. This is the matching credit,
        // and it is a LIABILITY, not revenue: a tip is the staff's money that the restaurant is
        // holding. Crediting 4100 instead would overstate income and levy income tax on money the
        // business never earned. Omitted entirely at zero, like every other optional line here.
        long tips = totalTips(p);
        if (tips > 0) {
            lines.add(line(tag("TIPS_PAYABLE"), "Tips payable", 0, tips));
        }

        post(SOURCE_ORDER_REVENUE, p.orderId(), envelope,
                describeOrder("Order revenue", p.orderNo(), p.orderId()), lines,
                p.businessDate());
    }

    /**
     * The one line of an auto-posted entry a human ever reads on the journal list.
     *
     * <p>It used to be {@code "Order revenue " + orderId} — a UUID, on every row, for every closed
     * check. The order number the guest, the kitchen ticket, the printed bill, the order list and
     * the audit trail all use has ridden on {@code ORDER_CLOSED} as {@code orderNo} since the
     * contract was written; the recipe simply reached for the wrong field. An owner reconciling
     * takings against the ledger had no way to join the two without opening every entry one at a
     * time.
     *
     * <p>Falls back to the id when the producer sent no order number. That is deliberately the OLD
     * behaviour rather than an invented reference: the id is true and identifies the order, it is
     * merely unreadable, and a fabricated {@code ORD-…} would be far worse than an ugly one. The
     * ledger is immutable, so a description is written exactly once and can never be corrected —
     * which is also why this is resolved from the payload and never from a network lookup that
     * could fail and permanently freeze a UUID into the books.
     */
    private static String describeOrder(String what, String orderNo, UUID orderId) {
        return what + " " + (orderNo != null && !orderNo.isBlank() ? orderNo : String.valueOf(orderId));
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
    /**
     * PAYROLL_RUN_APPROVED -&gt; recognise the whole payroll obligation, split by who is owed.
     *
     * <pre>
     *   DR  SALARY_EXPENSE     gross - lateArrival
     *   CR  WAGES_PAYABLE      net          (owed to the employee, cleared on payment)
     *   CR  PAYE_PAYABLE       incomeTax    (owed to FBR)
     *   CR  EOBI_PAYABLE       eobi         (owed to EOBI)
     *   CR  EMPLOYEE_ADVANCES  advances     (an asset recovered, not income)
     * </pre>
     *
     * <p><b>The drift this replaces.</b> This recipe used to credit the GROSS to Wages Payable
     * while {@link #postPayrollPaid} cleared only the NET. The withheld difference — income tax,
     * the EOBI employee share, advance recovery, the late-arrival deduction — was credited to
     * nothing, so account 2300 grew by that amount EVERY payroll cycle and never came back down.
     * Both entries balanced on their own, so no trigger fired, no consumer failed, and no
     * reconciliation complained: the ledger simply drifted, silently, forever. Same shape as the
     * pre-V8 loyalty liability, which drifted the other way for the mirror-image reason.
     *
     * <p><b>Why these two lines are not payables.</b> {@code lateArrival} reduces salary EXPENSE
     * rather than crediting anything: it is a cost the employer never incurred, so booking the full
     * gross to 6200 and a payable for the deduction would overstate both. {@code advances} credits
     * the employee-advances ASSET: recovering an advance settles a receivable, it is not revenue.
     *
     * <p>The entry balances by construction because hr-service computes
     * {@code net = gross - tax - eobi - advances - lateArrival} per payslip, hence
     * {@code net + tax + eobi + advances == gross - lateArrival}. It is re-checked here anyway —
     * a producer that ever breaks the identity must fail loudly, not post a plausible number.
     */
    public void postPayrollApproved(EventEnvelope<HrEventContract.PayrollApprovedPayload> envelope) {
        HrEventContract.PayrollApprovedPayload p = envelope.payload();
        UUID runId = p.runId();
        if (runId == null || alreadyPosted(SOURCE_PAYROLL_APPROVED, runId)) {
            return;
        }

        long gross = p.totalGrossPaisa();
        long net = p.totalNetPaisa();
        long tax = p.totalTaxPaisa();
        long eobi = p.totalEobiPaisa();
        long advances = p.totalAdvancesPaisa();
        long lateArrival = p.totalLateArrivalPaisa();

        // A negative component is a real defect upstream, not a small run. The old code returned
        // silently on gross <= 0, which folded "nothing to post" and "the producer sent nonsense"
        // into the same no-op: a run could be approved and later marked PAID with no entry on
        // either side and nothing anywhere to say so.
        requireNonNegative(runId, SOURCE_PAYROLL_APPROVED,
                "totalGrossPaisa", gross, "totalNetPaisa", net, "totalTaxPaisa", tax,
                "totalEobiPaisa", eobi, "totalAdvancesPaisa", advances,
                "totalLateArrivalPaisa", lateArrival);

        long salaryExpense = gross - lateArrival;
        long payables = net + tax + eobi + advances;
        if (salaryExpense != payables) {
            // Also the tripwire for a legacy pre-V9 payload, whose absent component fields
            // deserialize to 0: gross > 0 with everything else 0 lands here and dead-letters with
            // the numbers in the message, rather than re-posting the drift it exists to remove.
            throw new IllegalStateException(
                    "PAYROLL_RUN_APPROVED for run " + runId + " does not balance: salary expense ("
                            + gross + " gross - " + lateArrival + " lateArrival = " + salaryExpense
                            + ") != credits (" + net + " net + " + tax + " tax + " + eobi + " eobi + "
                            + advances + " advances = " + payables + ")");
        }

        if (salaryExpense == 0) {
            // A run with no employees, or one whose pay exactly cancels out. Nothing to post, but
            // it is worth a line in the log — a zero payroll run is almost always a symptom.
            log.warn("PAYROLL_RUN_APPROVED for run {} has a zero salary expense; no journal entry posted", runId);
            return;
        }

        // Resolve by system tag, not by literal code — the CoA is tenant-editable, so a renumbered
        // or deactivated account would otherwise fail deep inside JE validation and dead-letter the
        // message with no usable diagnostic. tag() enforces tenant scoping + isActive and throws a
        // clean AccountNotConfiguredException. Every other recipe in this class already does this.
        List<CreateJeLineRequest> lines = new ArrayList<>();
        lines.add(line(tag("SALARY_EXPENSE"), "Salary expense", salaryExpense, 0));
        // Zero-valued lines are omitted rather than posted: a tenant with no advances should not
        // carry an empty 1750 line on every payroll entry. The balance check above already
        // guarantees the surviving lines still sum to the debit.
        if (net > 0) {
            lines.add(line(tag("WAGES_PAYABLE"), "Wages payable", 0, net));
        }
        if (tax > 0) {
            lines.add(line(tag("PAYE_PAYABLE"), "Income tax withheld", 0, tax));
        }
        if (eobi > 0) {
            lines.add(line(tag("EOBI_PAYABLE"), "EOBI employee contribution", 0, eobi));
        }
        if (advances > 0) {
            lines.add(line(tag("EMPLOYEE_ADVANCES"), "Advance recovered", 0, advances));
        }
        post(SOURCE_PAYROLL_APPROVED, runId, envelope, "Payroll approved " + runId, lines);
    }

    /**
     * PAYROLL_RUN_PAID -&gt; DR WAGES_PAYABLE · CR BANK, for the net disbursed.
     *
     * <p>Unchanged in shape, and now correct in effect: the approved entry credits Wages Payable
     * the NET (not the gross), so this clears account 2300 to exactly zero per run.
     */
    public void postPayrollPaid(EventEnvelope<HrEventContract.PayrollPaidPayload> envelope) {
        HrEventContract.PayrollPaidPayload p = envelope.payload();
        UUID runId = p.runId();
        if (runId == null || alreadyPosted(SOURCE_PAYROLL_PAID, runId)) {
            return;
        }
        long netPaisa = p.totalNetPaisa();
        requireNonNegative(runId, SOURCE_PAYROLL_PAID, "totalNetPaisa", netPaisa);
        if (netPaisa == 0) {
            log.warn("PAYROLL_RUN_PAID for run {} has a zero net; no disbursement entry posted", runId);
            return;
        }
        List<CreateJeLineRequest> lines = List.of(
                line(tag("WAGES_PAYABLE"), "Wages payable", netPaisa, 0),
                line(tag("BANK"), "Payroll disbursement", 0, netPaisa));
        post(SOURCE_PAYROLL_PAID, runId, envelope, "Payroll paid " + runId, lines);
    }

    /**
     * Rejects a negative payroll amount loudly. Takes {@code (name, value)} pairs so the failure
     * names the field, not just the number.
     */
    private static void requireNonNegative(UUID runId, String sourceType, Object... nameValuePairs) {
        for (int i = 0; i < nameValuePairs.length; i += 2) {
            String name = (String) nameValuePairs[i];
            long value = (Long) nameValuePairs[i + 1];
            if (value < 0) {
                log.warn("{} for run {} carries a negative {} of {} paisa; refusing to post", sourceType, runId, name, value);
                throw new IllegalStateException(
                        sourceType + " for run " + runId + " carries a negative " + name + ": " + value + " paisa");
            }
        }
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
            // F20: the tender's debit is what the guest actually parted with — the applied amount
            // PLUS the tip. The tip is credited to TIPS_PAYABLE by the caller, so the entry
            // balances; debiting only amountPaisa while crediting the tip would leave it short by
            // exactly the tip and the deferred trigger would reject the whole entry.
            long debit = payment.amountPaisa() + payment.tipPaisa();
            if (debit <= 0) {
                continue;
            }
            String method = payment.method() != null ? payment.method() : "CASH";
            String accountTag = switch (method) {
                case "CARD", "BANK_TRANSFER" -> "BANK";
                case "LOYALTY_POINTS" -> "LOYALTY_LIABILITY";
                case "VOUCHER" -> "VOUCHER_LIABILITY";
                default -> "CASH";
            };
            lines.add(line(tag(accountTag), method + " payment", debit, 0));
        }
    }

    /**
     * Every tip on this check, summed. Zero for the overwhelming majority of orders and for every
     * ORDER_CLOSED published before F20 — {@code PaymentEntry}'s legacy constructor defaults the
     * field, so a replayed old event posts exactly what it posted before.
     */
    private static long totalTips(PosEventContract.OrderClosedPayload payload) {
        if (payload.payments() == null) {
            return 0L;
        }
        return payload.payments().stream()
                .mapToLong(PosEventContract.PaymentEntry::tipPaisa)
                .filter(t -> t > 0)
                .sum();
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
