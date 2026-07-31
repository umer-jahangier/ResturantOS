package io.restaurantos.purchasing.web;

import io.restaurantos.purchasing.dto.OrderSuggestionDto.CreateFromSuggestionsRequest;
import io.restaurantos.purchasing.dto.OrderSuggestionDto.OrderSuggestionsResponse;
import io.restaurantos.purchasing.dto.PurchaseOrderDto;
import io.restaurantos.purchasing.service.OrderSuggestionService;
import io.restaurantos.shared.api.ApiResponse;
import io.restaurantos.shared.feature.RequiresFeature;
import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.security.access.prepost.PreAuthorize;

import java.util.List;
import java.util.UUID;

/**
 * Order suggestions: what has fallen below its reorder point at a branch, how much it takes to
 * bring each item back to par, and which supplier sells it.
 *
 * <p>Permissions mirror {@link PurchaseOrderController}: reading suggestions needs
 * {@code vendor.view} (it exposes nothing a vendor catalogue does not already), while turning them
 * into drafts needs {@code vendor.po.create} — it creates real purchase orders, so it sits behind
 * the same authority as typing one by hand. No new permission code is introduced.
 */
@RestController
@RequestMapping("/api/v1/purchasing/order-suggestions")
@RequiresFeature("FEATURE_VENDOR")
public class OrderSuggestionController {

    private final OrderSuggestionService orderSuggestionService;

    public OrderSuggestionController(OrderSuggestionService orderSuggestionService) {
        this.orderSuggestionService = orderSuggestionService;
    }

    @GetMapping
    @PreAuthorize("hasAuthority('vendor.view')")
    public ApiResponse<OrderSuggestionsResponse> suggestions(@RequestParam UUID branchId) {
        return ApiResponse.ok(orderSuggestionService.suggestForBranch(branchId));
    }

    /**
     * Creates one DRAFT purchase order per vendor from the lines the caller accepted. Returns the
     * drafts so the UI can link straight to them — a buyer who just approved eight lines should not
     * have to go hunting through the PO list for what they made.
     */
    @PostMapping("/drafts")
    @PreAuthorize("hasAuthority('vendor.po.create')")
    public ApiResponse<List<PurchaseOrderDto>> createDrafts(
            @Valid @RequestBody CreateFromSuggestionsRequest request) {
        return ApiResponse.ok(orderSuggestionService.createDrafts(request));
    }
}
