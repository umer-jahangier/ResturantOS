package io.restaurantos.purchasing.feign;

import io.restaurantos.purchasing.config.FeignClientConfig;
import io.restaurantos.shared.api.ApiResponse;
import org.springframework.cloud.openfeign.FeignClient;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;

import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

@FeignClient(name = "finance-service", configuration = FeignClientConfig.class)
public interface FinanceInternalClient {

    @PostMapping("/internal/finance/journal-entries")
    ApiResponse<JePostResponse> autoPost(@RequestHeader("X-Tenant-Id") UUID tenantId,
                                           @RequestBody AutoPostJeRequest request);

    record AutoPostJeRequest(
            UUID branchId,
            LocalDate entryDate,
            String description,
            String sourceType,
            UUID sourceId,
            List<JeLine> lines
    ) {}

    record JeLine(String accountCode, String description, long debitPaisa, long creditPaisa) {}

    record JePostResponse(UUID jeId, String entryNo) {}
}
