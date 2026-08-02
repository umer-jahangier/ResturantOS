package io.restaurantos.pos.feign;

import io.restaurantos.pos.config.FeignClientConfig;
import io.restaurantos.shared.api.ApiResponse;
import org.springframework.cloud.openfeign.FeignClient;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;

import java.time.LocalDate;
import java.util.UUID;

/**
 * The "charge to account" seam (FIN-05 SC7 / Phase 7 SC7 / roadmap plan 07-09).
 *
 * <p>Phase 10 plan 10-18 built {@code POST /internal/finance/ar/charges} complete with a
 * credit-limit invariant, idempotency on {@code (tenantId, POS_ORDER, orderId)} and a documented
 * failure contract for POS — and then nothing called it. The AR ledger had a writer only from the
 * Finance module's own screen, never from the till, which is the only place a real charge
 * originates. This is that caller.
 *
 * <p>The receivable and its balanced journal entry (DR 1200 Accounts Receivable / CR revenue) are
 * created by finance-service. POS never posts to the ledger itself.
 */
@FeignClient(name = "finance-service", contextId = "financeArClient", configuration = FeignClientConfig.class)
public interface FinanceArClient {

    @PostMapping("/internal/finance/ar/charges")
    ApiResponse<ArChargeResponse> charge(@RequestHeader("X-Tenant-Id") UUID tenantId,
                                         @RequestBody ArChargeRequest request);

    record ArChargeRequest(
            UUID branchId,
            UUID customerAccountId,
            UUID orderId,
            LocalDate chargeDate,
            long amountPaisa,
            String reference,
            String revenueAccountCode
    ) {}

    record ArChargeResponse(UUID id, UUID customerAccountId, long amountPaisa, String type) {}
}
