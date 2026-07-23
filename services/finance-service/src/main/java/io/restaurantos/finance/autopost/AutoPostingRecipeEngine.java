package io.restaurantos.finance.autopost;

import io.restaurantos.finance.dto.CreateJeLineRequest;
import io.restaurantos.finance.dto.InternalAutoPostJeRequest;
import io.restaurantos.finance.dto.InternalJePostResponse;
import io.restaurantos.finance.service.JournalEntryService;
import io.restaurantos.shared.event.EventEnvelope;
import io.restaurantos.shared.tenant.TenantContext;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;

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

    private static final String LOYALTY_LIABILITY_CODE = "2400";
    private static final String DISCOUNT_CODE = "4920";
    private static final String WASTAGE_CODE = "5220";
    private static final String COUNT_LOSS_CODE = "5220";
    private static final String COUNT_GAIN_CODE = "5221";

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

    public void postOrderRevenue(EventEnvelope<Map<String, Object>> envelope) {
        Map<String, Object> p = envelope.payload();
        UUID orderId = uuid(p, "orderId");
        if (alreadyPosted(SOURCE_ORDER_REVENUE, orderId)) {
            return;
        }

        long subtotal = longVal(p, "subtotalPaisa");
        long discount = longVal(p, "discountPaisa");
        long tax = longVal(p, "taxPaisa");
        long netRevenue = subtotal - discount;

        List<CreateJeLineRequest> lines = new ArrayList<>();
        addPaymentDebits(p, lines);

        if (discount > 0) {
            lines.add(line(DISCOUNT_CODE, "Discount", discount, 0));
        }
        if (netRevenue > 0) {
            lines.add(line(accountResolver.codeBySystemTag("REVENUE"), "Sales revenue", 0, netRevenue));
        }
        if (tax > 0) {
            lines.add(line(accountResolver.codeBySystemTag("OUTPUT_TAX"), "Output tax", 0, tax));
        }

        post(SOURCE_ORDER_REVENUE, orderId, envelope, "Order revenue " + orderId, lines);
    }

    public void postOrderCogs(EventEnvelope<Map<String, Object>> envelope) {
        Map<String, Object> p = envelope.payload();
        UUID orderId = uuid(p, "orderId");
        if (alreadyPosted(SOURCE_ORDER_COGS, orderId)) {
            return;
        }

        long totalCogs = longVal(p, "totalCogsPaisa");
        if (totalCogs <= 0) {
            return;
        }

        List<CreateJeLineRequest> lines = List.of(
                line(accountResolver.codeBySystemTag("COGS"), "COGS", totalCogs, 0),
                line(accountResolver.codeBySystemTag("INVENTORY"), "Inventory", 0, totalCogs));

        post(SOURCE_ORDER_COGS, orderId, envelope, "Order COGS " + orderId, lines);
    }

    public void postOrderRefund(EventEnvelope<Map<String, Object>> envelope) {
        Map<String, Object> p = envelope.payload();
        UUID orderId = uuid(p, "orderId");
        if (alreadyPosted(SOURCE_ORDER_REFUND, orderId)) {
            return;
        }

        long refundPaisa = longVal(p, "refundPaisa");
        if (refundPaisa <= 0) {
            return;
        }

        // Approximate tax reversal at 7% if not provided — use full refund as sales refund for simplicity
        long salesRefund = refundPaisa;
        String cashCode = accountResolver.codeBySystemTag("CASH");

        List<CreateJeLineRequest> lines = List.of(
                line(DISCOUNT_CODE, "Sales refund", salesRefund, 0),
                line(cashCode, "Cash refund", 0, salesRefund));

        post(SOURCE_ORDER_REFUND, orderId, envelope, "Order refund " + orderId, lines);
    }

    public void postWastage(EventEnvelope<Map<String, Object>> envelope) {
        Map<String, Object> p = envelope.payload();
        UUID wastageId = uuid(p, "wastageId");
        if (alreadyPosted(SOURCE_WASTAGE, wastageId)) {
            return;
        }

        long cost = longVal(p, "costPaisa");
        if (cost <= 0) {
            return;
        }

        List<CreateJeLineRequest> lines = List.of(
                line(WASTAGE_CODE, "Wastage", cost, 0),
                line(accountResolver.codeBySystemTag("INVENTORY"), "Inventory", 0, cost));

        post(SOURCE_WASTAGE, wastageId, envelope, "Wastage " + wastageId, lines);
    }

    @SuppressWarnings("unchecked")
    public void postCountVariance(EventEnvelope<Map<String, Object>> envelope) {
        Map<String, Object> p = envelope.payload();
        UUID countId = uuid(p, "countId");
        if (alreadyPosted(SOURCE_COUNT_VARIANCE, countId)) {
            return;
        }

        List<Map<String, Object>> countLines = (List<Map<String, Object>>) p.get("lines");
        if (countLines == null || countLines.isEmpty()) {
            return;
        }

        List<CreateJeLineRequest> lines = new ArrayList<>();
        String inventoryCode = accountResolver.codeBySystemTag("INVENTORY");

        for (Map<String, Object> cl : countLines) {
            long variancePaisa = longVal(cl, "variancePaisa");
            if (variancePaisa == 0) {
                continue;
            }
            if (variancePaisa < 0) {
                long amount = Math.abs(variancePaisa);
                lines.add(line(COUNT_LOSS_CODE, "Count loss", amount, 0));
                lines.add(line(inventoryCode, "Inventory reduction", 0, amount));
            } else {
                lines.add(line(inventoryCode, "Inventory increase", variancePaisa, 0));
                lines.add(line(COUNT_GAIN_CODE, "Count gain", 0, variancePaisa));
            }
        }

        if (lines.isEmpty()) {
            return;
        }

        post(SOURCE_COUNT_VARIANCE, countId, envelope, "Count variance " + countId, lines);
    }

    @SuppressWarnings("unchecked")
    public void postTransferShipped(EventEnvelope<Map<String, Object>> envelope) {
        Map<String, Object> p = envelope.payload();
        UUID transferId = uuid(p, "transferId");
        if (alreadyPosted(SOURCE_TRANSFER_SHIP, transferId)) {
            return;
        }

        List<Map<String, Object>> transferLines = (List<Map<String, Object>>) p.get("lines");
        long totalCost = 0;
        if (transferLines != null) {
            for (Map<String, Object> tl : transferLines) {
                totalCost += longVal(tl, "costPaisa");
            }
        }
        if (totalCost <= 0) {
            return;
        }

        List<CreateJeLineRequest> lines = List.of(
                line(accountResolver.codeBySystemTag("INVENTORY_TRANSIT"), "Goods in transit", totalCost, 0),
                line(accountResolver.codeBySystemTag("INVENTORY"), "Inventory shipped", 0, totalCost));

        post(SOURCE_TRANSFER_SHIP, transferId, envelope, "Transfer shipped " + transferId, lines);
    }

    @SuppressWarnings("unchecked")
    public void postTransferReceived(EventEnvelope<Map<String, Object>> envelope) {
        Map<String, Object> p = envelope.payload();
        UUID transferId = uuid(p, "transferId");
        if (alreadyPosted(SOURCE_TRANSFER_RECV, transferId)) {
            return;
        }

        List<Map<String, Object>> transferLines = (List<Map<String, Object>>) p.get("lines");
        long totalCost = 0;
        if (transferLines != null) {
            for (Map<String, Object> tl : transferLines) {
                totalCost += longVal(tl, "costPaisa");
            }
        }
        if (totalCost <= 0) {
            return;
        }

        List<CreateJeLineRequest> lines = List.of(
                line(accountResolver.codeBySystemTag("INVENTORY"), "Inventory received", totalCost, 0),
                line(accountResolver.codeBySystemTag("INVENTORY_TRANSIT"), "Clear transit", 0, totalCost));

        post(SOURCE_TRANSFER_RECV, transferId, envelope, "Transfer received " + transferId, lines);
    }

    private void post(String sourceType, UUID sourceId, EventEnvelope<Map<String, Object>> envelope,
                      String description, List<CreateJeLineRequest> lines) {
        UUID tenantId = tenantContext.requireTenantId();
        UUID branchId = envelope.branchId() != null
                ? envelope.branchId()
                : tenantContext.getBranchId().orElseThrow(() -> new IllegalStateException("branchId required"));

        LocalDate entryDate = envelope.occurredAt() != null
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

    @SuppressWarnings("unchecked")
    private void addPaymentDebits(Map<String, Object> payload, List<CreateJeLineRequest> lines) {
        Object paymentsObj = payload.get("payments");
        if (!(paymentsObj instanceof List<?> payments) || payments.isEmpty()) {
            long total = longVal(payload, "totalPaisa");
            lines.add(line(accountResolver.codeBySystemTag("CASH"), "Cash", total, 0));
            return;
        }

        for (Object item : payments) {
            if (!(item instanceof Map<?, ?> raw)) {
                continue;
            }
            Map<String, Object> payment = (Map<String, Object>) raw;
            long amount = longVal(payment, "amountPaisa");
            if (amount <= 0) {
                continue;
            }
            String method = stringVal(payment, "method", "CASH");
            String accountCode = switch (method) {
                case "CARD", "WALLET" -> accountResolver.codeBySystemTag("BANK");
                case "LOYALTY_POINTS" -> accountResolver.codeByAccountCode(LOYALTY_LIABILITY_CODE);
                default -> accountResolver.codeBySystemTag("CASH");
            };
            lines.add(line(accountCode, method + " payment", amount, 0));
        }
    }

    private boolean alreadyPosted(String sourceType, UUID sourceId) {
        return postedSourceRepo.existsByTenantIdAndSourceTypeAndSourceId(
                tenantContext.requireTenantId(), sourceType, sourceId);
    }

    private static CreateJeLineRequest line(String code, String desc, long debit, long credit) {
        return new CreateJeLineRequest(code, desc, debit, credit);
    }

    private static UUID uuid(Map<String, Object> map, String key) {
        Object v = map.get(key);
        if (v == null) {
            throw new IllegalArgumentException("Missing payload field: " + key);
        }
        return UUID.fromString(v.toString());
    }

    private static long longVal(Map<String, Object> map, String key) {
        Object v = map.get(key);
        if (v == null) {
            return 0L;
        }
        if (v instanceof Number n) {
            return n.longValue();
        }
        return Long.parseLong(v.toString());
    }

    private static String stringVal(Map<String, Object> map, String key, String defaultVal) {
        Object v = map.get(key);
        return v != null ? v.toString() : defaultVal;
    }
}
