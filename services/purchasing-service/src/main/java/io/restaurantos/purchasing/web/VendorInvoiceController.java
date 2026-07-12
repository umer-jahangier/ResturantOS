package io.restaurantos.purchasing.web;

import io.restaurantos.purchasing.dto.CreateVendorInvoiceRequest;
import io.restaurantos.purchasing.dto.VendorInvoiceDto;
import io.restaurantos.purchasing.service.VendorInvoiceService;
import io.restaurantos.shared.api.ApiResponse;
import io.restaurantos.shared.feature.RequiresFeature;
import jakarta.validation.Valid;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

import java.util.Map;
import java.util.UUID;

@RestController
@RequestMapping("/api/v1/purchasing/invoices")
@RequiresFeature("FEATURE_VENDOR")
public class VendorInvoiceController {

    private final VendorInvoiceService vendorInvoiceService;

    public VendorInvoiceController(VendorInvoiceService vendorInvoiceService) {
        this.vendorInvoiceService = vendorInvoiceService;
    }

    @PostMapping
    @PreAuthorize("hasAuthority('vendor.invoice.book')")
    public ApiResponse<VendorInvoiceDto> create(@Valid @RequestBody CreateVendorInvoiceRequest req) {
        return ApiResponse.ok(vendorInvoiceService.create(req));
    }

    @GetMapping("/{id}")
    @PreAuthorize("hasAuthority('vendor.view')")
    public ApiResponse<VendorInvoiceDto> get(@PathVariable UUID id) {
        return ApiResponse.ok(vendorInvoiceService.get(id));
    }

    @PostMapping("/{id}/override-match")
    @PreAuthorize("hasAuthority('vendor.invoice.override')")
    public ApiResponse<VendorInvoiceDto> overrideMatch(@PathVariable UUID id,
                                                       @RequestBody Map<String, String> body) {
        return ApiResponse.ok(vendorInvoiceService.overrideMatch(id, body.get("justification")));
    }
}
