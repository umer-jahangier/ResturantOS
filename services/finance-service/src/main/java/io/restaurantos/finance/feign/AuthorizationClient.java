package io.restaurantos.finance.feign;

import io.restaurantos.shared.api.ApiResponse;
import org.springframework.cloud.openfeign.FeignClient;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;

import java.util.UUID;

/**
 * Feign client to authorization-service's internal OPA gateway.
 *
 * NOTE: shared-lib DOES ship io.restaurantos.shared.authz.OpaClient/AuthorizationService, but
 * SharedAutoConfiguration only registers that bean under
 * @ConditionalOnProperty("restaurantos.opa.url"), which finance-service does not set. This Feign
 * client mirrors services/purchasing-service's AuthorizationClient (used by PoApprovalService)
 * instead of wiring shared-lib's OpaClient, which would fail with NoSuchBeanDefinitionException.
 */
@FeignClient(name = "authorization-service", path = "/internal")
public interface AuthorizationClient {

    @PostMapping("/authorize")
    ApiResponse<AuthorizeResult> authorize(@RequestBody AuthorizePayload payload);

    record AuthorizePayload(String module, String action, Resource resource) {}

    record Resource(String type, UUID id, UUID tenantId, UUID branchId, UUID createdBy, String status, Long amountPaisa) {}

    record AuthorizeResult(boolean allow, String reason) {}
}
