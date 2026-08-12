package io.restaurantos.crm.controller.internal;

import io.restaurantos.crm.dto.CrmDtos.CustomerLookupResponse;
import io.restaurantos.crm.dto.CrmDtos.EvaluatePromotionRequest;
import io.restaurantos.crm.dto.CrmDtos.EvaluatePromotionResponse;
import io.restaurantos.crm.service.CustomerService;
import io.restaurantos.crm.service.PromotionEngine;
import io.restaurantos.shared.tenant.TenantContext;
import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.UUID;

@RestController
@RequestMapping("/internal/crm")
public class CrmInternalController {

    private final CustomerService customerService;
    private final PromotionEngine promotionEngine;
    private final TenantContext tenantContext;

    public CrmInternalController(CustomerService customerService,
                                 PromotionEngine promotionEngine,
                                 TenantContext tenantContext) {
        this.customerService = customerService;
        this.promotionEngine = promotionEngine;
        this.tenantContext = tenantContext;
    }

    @GetMapping("/customers/lookup")
    public CustomerLookupResponse lookup(@RequestParam String phone) {
        return customerService.lookupByPhone(phone);
    }

    /**
     * S0-05 — customer ids matching {@code q} (phone prefix or name), for pos-service's Order
     * Management search.
     *
     * <p>{@code X-Tenant-Id} is REQUIRED and is not decoration. This controller is reached with
     * the shared-secret header and no JWT, so nothing else has populated {@link TenantContext};
     * without the header {@code requireTenantId()} throws and the call 500s. Explicitly setting
     * it here — the pattern pos-service's own {@code InternalPosController} already uses — is
     * what makes the tenant predicate in {@code CustomerRepository.searchIds} resolvable AND
     * what stops a caller from reading a sibling tenant's customer book.
     */
    @GetMapping("/customers/ids")
    public List<UUID> searchCustomerIds(
            @RequestParam String q,
            @RequestParam(defaultValue = "50") int limit,
            @RequestHeader("X-Tenant-Id") UUID tenantId) {
        if (tenantContext.getTenantId().isEmpty()) {
            tenantContext.set(tenantId, null, null, null);
        }
        return customerService.searchIds(q, limit);
    }

    @PostMapping("/promotions/evaluate")
    public EvaluatePromotionResponse evaluate(@Valid @RequestBody EvaluatePromotionRequest req) {
        return promotionEngine.evaluate(req);
    }
}
