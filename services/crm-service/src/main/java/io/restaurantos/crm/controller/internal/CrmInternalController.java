package io.restaurantos.crm.controller.internal;

import io.restaurantos.crm.dto.CrmDtos.CustomerLookupResponse;
import io.restaurantos.crm.dto.CrmDtos.EvaluatePromotionRequest;
import io.restaurantos.crm.dto.CrmDtos.EvaluatePromotionResponse;
import io.restaurantos.crm.service.CustomerService;
import io.restaurantos.crm.service.PromotionEngine;
import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/internal/crm")
public class CrmInternalController {

    private final CustomerService customerService;
    private final PromotionEngine promotionEngine;

    public CrmInternalController(CustomerService customerService, PromotionEngine promotionEngine) {
        this.customerService = customerService;
        this.promotionEngine = promotionEngine;
    }

    @GetMapping("/customers/lookup")
    public CustomerLookupResponse lookup(@RequestParam String phone) {
        return customerService.lookupByPhone(phone);
    }

    @PostMapping("/promotions/evaluate")
    public EvaluatePromotionResponse evaluate(@Valid @RequestBody EvaluatePromotionRequest req) {
        return promotionEngine.evaluate(req);
    }
}
