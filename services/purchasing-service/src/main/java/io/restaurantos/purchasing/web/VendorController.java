package io.restaurantos.purchasing.web;

import io.restaurantos.purchasing.dto.CreateVendorRequest;
import io.restaurantos.purchasing.dto.VendorDto;
import io.restaurantos.purchasing.repository.VendorRepository;
import io.restaurantos.purchasing.service.VendorService;
import io.restaurantos.shared.api.ApiResponse;
import io.restaurantos.shared.api.PageMeta;
import io.restaurantos.shared.feature.RequiresFeature;
import io.restaurantos.shared.tenant.TenantContext;
import jakarta.validation.Valid;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

import java.util.UUID;

@RestController
@RequestMapping("/api/v1/purchasing/vendors")
@RequiresFeature("FEATURE_VENDOR")
public class VendorController {

    private final VendorService vendorService;
    private final VendorRepository vendorRepository;
    private final TenantContext tenantContext;

    public VendorController(VendorService vendorService, VendorRepository vendorRepository, TenantContext tenantContext) {
        this.vendorService = vendorService;
        this.vendorRepository = vendorRepository;
        this.tenantContext = tenantContext;
    }

    @GetMapping
    @PreAuthorize("hasAuthority('vendor.view')")
    public ApiResponse<java.util.List<VendorDto>> list(
            @RequestParam(required = false) String search,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size) {
        Page<VendorDto> result = vendorService.list(search, PageRequest.of(page, size));
        return ApiResponse.paginated(result.getContent(), new PageMeta(
                new PageMeta.Page(String.valueOf(page), result.hasNext() ? String.valueOf(page + 1) : null, size),
                result.getTotalElements()));
    }

    @PostMapping
    @PreAuthorize("hasAuthority('vendor.manage')")
    public ResponseEntity<ApiResponse<VendorDto>> create(@Valid @RequestBody CreateVendorRequest req) {
        UUID tenantId = tenantContext.requireTenantId();
        HttpHeaders headers = new HttpHeaders();
        if (vendorRepository.existsByTenantIdAndNameIgnoreCase(tenantId, req.name())) {
            headers.add("X-Duplicate-Vendor-Name", "true");
        }
        return ResponseEntity.ok().headers(headers).body(ApiResponse.ok(vendorService.create(req)));
    }

    @PutMapping("/{id}")
    @PreAuthorize("hasAuthority('vendor.manage')")
    public ApiResponse<VendorDto> update(@PathVariable UUID id, @Valid @RequestBody CreateVendorRequest req) {
        return ApiResponse.ok(vendorService.update(id, req));
    }
}
