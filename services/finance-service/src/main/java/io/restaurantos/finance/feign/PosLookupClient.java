package io.restaurantos.finance.feign;

import io.restaurantos.finance.config.PosLookupFeignConfig;
import io.restaurantos.finance.dto.InternalOrderSummary;
import org.springframework.cloud.openfeign.FeignClient;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;

import java.util.UUID;

/**
 * Reads an order's human-readable summary for a journal entry's source reference (37-04).
 *
 * <p>NO fallback is configured, deliberately — unlike {@link PosInternalClient}. A fallback returns
 * a value, and any value here would be a fabricated order reference. The resolver catches the
 * exception instead and produces an explicit {@code LOOKUP_FAILED} state carrying the reason
 * (D-37-05). An enrichment must never be able to invent what it is enriching.
 */
@FeignClient(name = "pos-service", contextId = "posLookupClient", configuration = PosLookupFeignConfig.class)
public interface PosLookupClient {

    @GetMapping("/internal/orders/{orderId}/summary")
    InternalOrderSummary getOrderSummary(@PathVariable("orderId") UUID orderId);
}
