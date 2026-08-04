package io.restaurantos.purchasing.web;

import io.restaurantos.purchasing.dto.CreateVendorItemRequest;
import io.restaurantos.purchasing.dto.RecordVendorItemPriceRequest;
import io.restaurantos.purchasing.dto.UpdateVendorItemRequest;
import io.restaurantos.purchasing.dto.VendorCategoryDto;
import io.restaurantos.purchasing.dto.VendorItemDto;
import io.restaurantos.purchasing.dto.VendorItemPriceChangeDto;
import io.restaurantos.purchasing.dto.VendorItemPriceDto;
import io.restaurantos.purchasing.service.VendorItemPriceService;
import io.restaurantos.purchasing.service.VendorItemService;
import io.restaurantos.shared.api.ApiResponse;
import io.restaurantos.shared.api.PageMeta;
import io.restaurantos.shared.feature.RequiresFeature;
import jakarta.validation.Valid;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * The vendor item catalog API (PUR-07): a vendor's SKU/pack/UOM/MOQ/lead-time catalog with
 * append-only effective-dated pricing and filter-only category tags. There is no hard-delete
 * route anywhere — catalog rows are archived, never removed (RESEARCH §9.4), and category tags
 * are never an input to any authorization expression here.
 */
@RestController
@RequestMapping("/api/v1/purchasing")
@RequiresFeature("FEATURE_VENDOR")
public class VendorItemController {

    private final VendorItemService vendorItemService;
    private final VendorItemPriceService vendorItemPriceService;

    public VendorItemController(VendorItemService vendorItemService, VendorItemPriceService vendorItemPriceService) {
        this.vendorItemService = vendorItemService;
        this.vendorItemPriceService = vendorItemPriceService;
    }

    @GetMapping("/vendors/{vendorId}/items")
    @PreAuthorize("hasAuthority('vendor.view')")
    public ApiResponse<List<VendorItemDto>> list(
            @PathVariable UUID vendorId,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size) {
        Page<VendorItemDto> result = vendorItemService.list(vendorId, PageRequest.of(page, size));
        return ApiResponse.paginated(result.getContent(), new PageMeta(
                new PageMeta.Page(String.valueOf(page), result.hasNext() ? String.valueOf(page + 1) : null, size),
                result.getTotalElements()));
    }

    @PostMapping("/vendors/{vendorId}/items")
    @PreAuthorize("hasAuthority('vendor.manage')")
    public ApiResponse<VendorItemDto> create(@PathVariable UUID vendorId,
                                              @Valid @RequestBody CreateVendorItemRequest req) {
        return ApiResponse.ok(vendorItemService.create(vendorId, req));
    }

    @PutMapping("/vendor-items/{id}")
    @PreAuthorize("hasAuthority('vendor.manage')")
    public ApiResponse<VendorItemDto> update(@PathVariable UUID id, @Valid @RequestBody UpdateVendorItemRequest req) {
        return ApiResponse.ok(vendorItemService.update(id, req));
    }

    @PostMapping("/vendor-items/{id}/archive")
    @PreAuthorize("hasAuthority('vendor.manage')")
    public ApiResponse<VendorItemDto> archive(@PathVariable UUID id) {
        return ApiResponse.ok(vendorItemService.archive(id));
    }

    @GetMapping("/vendor-items/{id}/prices")
    @PreAuthorize("hasAuthority('vendor.view')")
    public ApiResponse<List<VendorItemPriceDto>> listPrices(@PathVariable UUID id) {
        return ApiResponse.ok(vendorItemPriceService.listPrices(id));
    }

    @PostMapping("/vendor-items/{id}/prices")
    @PreAuthorize("hasAuthority('vendor.manage')")
    public ApiResponse<VendorItemPriceDto> recordPrice(@PathVariable UUID id,
                                                         @Valid @RequestBody RecordVendorItemPriceRequest req) {
        return ApiResponse.ok(vendorItemPriceService.recordNewPrice(id, req));
    }

    @GetMapping("/vendors/{vendorId}/price-changes")
    @PreAuthorize("hasAuthority('vendor.view')")
    public ApiResponse<List<VendorItemPriceChangeDto>> priceChanges(
            @PathVariable UUID vendorId,
            @RequestParam(required = false) Instant since) {
        return ApiResponse.ok(vendorItemPriceService.priceChanges(vendorId, since));
    }

    @GetMapping("/vendors/{vendorId}/categories")
    @PreAuthorize("hasAuthority('vendor.view')")
    public ApiResponse<List<VendorCategoryDto>> listCategories(@PathVariable UUID vendorId) {
        return ApiResponse.ok(vendorItemService.listCategories(vendorId));
    }

    @PutMapping("/vendors/{vendorId}/categories")
    @PreAuthorize("hasAuthority('vendor.manage')")
    public ApiResponse<List<VendorCategoryDto>> replaceCategories(
            @PathVariable UUID vendorId, @RequestBody List<VendorCategoryDto> categories) {
        return ApiResponse.ok(vendorItemService.replaceCategories(vendorId, categories));
    }
}
