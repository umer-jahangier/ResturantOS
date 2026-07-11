package io.restaurantos.purchasing.feign;

import io.restaurantos.shared.api.ApiResponse;
import org.springframework.cloud.openfeign.FeignClient;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;

import java.util.Map;
import java.util.UUID;

@FeignClient(name = "authorization-service", path = "/internal")
public interface AuthorizationClient {

    @PostMapping("/authorize")
    ApiResponse<AuthorizeResult> authorize(@RequestBody AuthorizePayload payload);

    record AuthorizePayload(String module, String action, Resource resource) {}

    record Resource(String type, UUID id, UUID tenantId, UUID branchId, UUID createdBy, String status, Long amountPaisa) {}

    record AuthorizeResult(boolean allow, String reason) {}
}
