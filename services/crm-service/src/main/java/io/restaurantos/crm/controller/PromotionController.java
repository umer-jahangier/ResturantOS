package io.restaurantos.crm.controller;

import io.restaurantos.crm.dto.CrmDtos.CreatePromotionRequest;
import io.restaurantos.crm.dto.CrmDtos.PromotionResponse;
import io.restaurantos.crm.service.PromotionEngine;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@RestController
@RequestMapping("/api/v1/crm/promotions")
public class PromotionController {

    private final PromotionEngine promotionEngine;

    public PromotionController(PromotionEngine promotionEngine) {
        this.promotionEngine = promotionEngine;
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    @PreAuthorize("hasAuthority('crm.promotion.manage')")
    public PromotionResponse create(@Valid @RequestBody CreatePromotionRequest req) {
        return promotionEngine.create(req);
    }

    @GetMapping
    @PreAuthorize("hasAuthority('crm.customer.view')")
    public List<PromotionResponse> list() {
        return promotionEngine.listActive();
    }
}
