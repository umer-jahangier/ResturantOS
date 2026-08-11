package io.restaurantos.finance.service;

import io.restaurantos.finance.dto.InternalOrderSummary;
import io.restaurantos.finance.dto.SourceReferenceDto;
import io.restaurantos.finance.feign.PosLookupClient;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.util.Set;
import java.util.UUID;

/**
 * Turns a journal entry's {@code (source_type, source_id)} into something an owner recognises —
 * or says plainly that it cannot (37-04, D-37-01 + D-37-05).
 *
 * <h2>The load-bearing rule</h2>
 *
 * <p>The ledger is the durable truth; this reference is an enrichment. An enrichment must NEVER be
 * able to take down what it enriches, and it must never substitute an invented value for a real
 * failure. Every failure path here returns a {@link SourceReferenceDto.State#LOOKUP_FAILED} carrying
 * the reason, and the journal entry is returned complete with every ledger field intact.
 *
 * <p>There is no Feign fallback for {@link PosLookupClient} on purpose: a fallback returns a value,
 * and any value here would be a fabricated order number.
 */
@Service
public class SourceReferenceResolver {

    private static final Logger log = LoggerFactory.getLogger(SourceReferenceResolver.class);

    /**
     * The auto-posting vocabulary whose source id IS an order id. Taken from
     * {@code AutoPostingRecipeEngine}'s post calls, not guessed.
     */
    private static final Set<String> ORDER_SOURCE_TYPES =
            Set.of("ORDER_REVENUE", "ORDER_COGS", "ORDER_REFUND");

    private final PosLookupClient posLookupClient;

    public SourceReferenceResolver(PosLookupClient posLookupClient) {
        this.posLookupClient = posLookupClient;
    }

    /**
     * @param sourceType may be null — a hand-written adjustment
     * @param sourceId   may be null — likewise
     */
    public SourceReferenceDto resolve(String sourceType, UUID sourceId) {
        // A hand-written adjustment. Distinct from a failure: there is nothing to look up, and
        // saying "could not be read" about it would be a lie.
        if (sourceType == null || sourceType.isBlank() || sourceId == null) {
            return SourceReferenceDto.notApplicable();
        }

        if (!ORDER_SOURCE_TYPES.contains(sourceType)) {
            // STOCK_RECEIPT, VENDOR_INVOICE, AP_PAYMENT, PAYROLL, COUNT_VARIANCE… finance knows
            // these types but has no lookup for them. Guessing a shape for them would be worse
            // than saying so.
            return SourceReferenceDto.unsupported(sourceType, sourceId);
        }

        try {
            InternalOrderSummary summary = posLookupClient.getOrderSummary(sourceId);
            if (summary == null || summary.orderNo() == null) {
                return SourceReferenceDto.lookupFailed(sourceType, sourceId,
                        "pos-service returned no order for this id");
            }
            return SourceReferenceDto.resolved(sourceType, sourceId, summary.orderNo(),
                    summary.branchId(), summary.cashierId(), summary.closedAt());
        } catch (Exception e) {
            // Catches the timeout, the 404, the 5xx and the circuit-breaker open state alike. The
            // ledger read must survive all of them.
            log.warn("SourceReferenceResolver: could not resolve {} {} — {}",
                    sourceType, sourceId, e.toString());
            return SourceReferenceDto.lookupFailed(sourceType, sourceId,
                    e.getClass().getSimpleName() + ": " + e.getMessage());
        }
    }
}
