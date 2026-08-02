package io.restaurantos.purchasing.feign;

import io.restaurantos.purchasing.config.FeignClientConfig;
import io.restaurantos.shared.api.ApiResponse;
import org.springframework.cloud.openfeign.FeignClient;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestParam;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

@FeignClient(name = "finance-service", configuration = FeignClientConfig.class)
public interface FinanceInternalClient {

    @PostMapping("/internal/finance/journal-entries")
    ApiResponse<JePostResponse> autoPost(@RequestHeader("X-Tenant-Id") UUID tenantId,
                                           @RequestBody AutoPostJeRequest request);

    /**
     * Chart-of-accounts lookup over the same {@code X-Internal-Service} seam inventory-service uses
     * for its category GL pickers. Backs the "Pay from" list on the AP payment dialog.
     */
    @GetMapping("/internal/finance/accounts/search")
    ApiResponse<List<GlAccountDto>> searchAccounts(
            @RequestHeader("X-Tenant-Id") UUID tenantId,
            @RequestParam("q") String q,
            @RequestParam("types") List<String> types,
            @RequestParam("size") int size);

    /**
     * Purchasing's view of a finance chart-of-accounts row. A deliberate copy of the wire contract
     * (the two services share no code), {@code ignoreUnknown} so a new field on finance's DTO
     * cannot start failing purchasing requests.
     */
    @JsonIgnoreProperties(ignoreUnknown = true)
    record GlAccountDto(
            UUID id,
            String code,
            String name,
            String accountType,
            String parentCode,
            boolean system,
            String systemTag,
            boolean active) {}

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
