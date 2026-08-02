package io.restaurantos.pos.feign;

import io.restaurantos.pos.config.FeignClientConfig;
import org.springframework.cloud.openfeign.FeignClient;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * CRM-04's caller: evaluates time/day/item/tier-filtered promotions for an order.
 *
 * <p>{@code POST /internal/crm/promotions/evaluate} and the whole {@code PromotionEngine} behind it
 * were built in Phase 9 and had zero callers — pos-service's only Feign client was the finance
 * period check. Promotions could be created and could never apply to anything.
 *
 * <p>Deliberately invoked from an explicit "apply promotions" action rather than folded into every
 * price calculation: a discount that appears on its own is one a cashier cannot explain to a
 * customer, and the resulting {@code OrderDiscount} row is what makes it auditable.
 */
@FeignClient(name = "crm-service", contextId = "crmPromotionClient", configuration = FeignClientConfig.class)
public interface CrmPromotionClient {

    @PostMapping("/internal/crm/promotions/evaluate")
    EvaluatePromotionResponse evaluate(@RequestBody EvaluatePromotionRequest request);

    record EvaluatePromotionRequest(
            UUID branchId,
            UUID customerId,
            long subtotalPaisa,
            Instant at,
            List<OrderItemLine> items
    ) {
        public record OrderItemLine(UUID menuItemId, long lineTotalPaisa) {}
    }

    record EvaluatePromotionResponse(long discountPaisa, List<UUID> appliedPromotionIds) {}
}
