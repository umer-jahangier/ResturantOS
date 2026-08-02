package io.restaurantos.crm.controller;

import io.restaurantos.crm.dto.CrmDtos.CreatePromotionRequest;
import io.restaurantos.crm.dto.CrmDtos.PromotionResponse;
import io.restaurantos.crm.service.PromotionEngine;
import io.restaurantos.shared.api.ApiResponse;
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

/**
 * Responses are wrapped in {@link ApiResponse}, matching every other service's controllers.
 * crm-service originally returned raw Spring types, which meant the four-layer frontend client —
 * whose {@code get()} helper unwraps {@code data} — could not consume it at all. Nothing depended
 * on the old shape: this module had no frontend and no HTTP-level test, because until changeset
 * 047 seeded the {@code crm.*} permissions every endpoint here returned 403.
 */
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
    public ApiResponse<PromotionResponse> create(@Valid @RequestBody CreatePromotionRequest req) {
        return ApiResponse.ok(promotionEngine.create(req));
    }

    // Gated on crm.promotion.view, not crm.customer.view: reading the promotion list is not a
    // customer-data read, and the two are granted to different roles in changeset 047.
    @GetMapping
    @PreAuthorize("hasAuthority('crm.promotion.view')")
    public ApiResponse<List<PromotionResponse>> list() {
        return ApiResponse.ok(promotionEngine.listActive());
    }
}
