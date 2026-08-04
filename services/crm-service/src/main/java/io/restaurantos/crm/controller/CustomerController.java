package io.restaurantos.crm.controller;

import io.restaurantos.crm.dto.CrmDtos;
import io.restaurantos.crm.dto.CrmDtos.CreateCustomerRequest;
import io.restaurantos.crm.dto.CrmDtos.CustomerResponse;
import io.restaurantos.crm.dto.CrmDtos.UpdateCustomerRequest;
import io.restaurantos.crm.service.CustomerService;
import io.restaurantos.shared.api.ApiResponse;
import jakarta.validation.Valid;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.util.UUID;

/**
 * Responses are wrapped in {@link ApiResponse}, matching every other service's controllers.
 * crm-service originally returned raw Spring types, which meant the four-layer frontend client —
 * whose {@code get()} helper unwraps {@code data} — could not consume it at all. Nothing depended
 * on the old shape: this module had no frontend and no HTTP-level test, because until changeset
 * 047 seeded the {@code crm.*} permissions every endpoint here returned 403.
 */
@RestController
@RequestMapping("/api/v1/crm/customers")
public class CustomerController {

    private final CustomerService customerService;

    public CustomerController(CustomerService customerService) {
        this.customerService = customerService;
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    @PreAuthorize("hasAuthority('crm.customer.manage')")
    public ApiResponse<CustomerResponse> create(@Valid @RequestBody CreateCustomerRequest req) {
        return ApiResponse.ok(customerService.create(req));
    }

    /**
     * Customer search — one endpoint for both the CRM grid and the POS customer picker, so a
     * cashier attaching a customer to an order needs only {@code crm.customer.view}.
     */
    @GetMapping("/search")
    @PreAuthorize("hasAuthority('crm.customer.view')")
    public ApiResponse<Page<CrmDtos.CustomerSummaryResponse>> search(
            @RequestParam(required = false) String q, Pageable pageable) {
        return ApiResponse.ok(customerService.search(q, pageable));
    }

    /** Customer with loyalty standing — the CRM detail page. */
    @GetMapping("/{id}/detail")
    @PreAuthorize("hasAuthority('crm.customer.view')")
    public ApiResponse<CrmDtos.CustomerSummaryResponse> detail(@PathVariable UUID id) {
        return ApiResponse.ok(customerService.getDetail(id));
    }

    @GetMapping
    @PreAuthorize("hasAuthority('crm.customer.view')")
    public ApiResponse<Page<CustomerResponse>> list(Pageable pageable) {
        return ApiResponse.ok(customerService.list(pageable));
    }

    @GetMapping("/{id}")
    @PreAuthorize("hasAuthority('crm.customer.view')")
    public ApiResponse<CustomerResponse> get(@PathVariable UUID id) {
        return ApiResponse.ok(customerService.getById(id));
    }

    @PutMapping("/{id}")
    @PreAuthorize("hasAuthority('crm.customer.manage')")
    public ApiResponse<CustomerResponse> update(@PathVariable UUID id, @RequestBody UpdateCustomerRequest req) {
        return ApiResponse.ok(customerService.update(id, req));
    }

    @DeleteMapping("/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @PreAuthorize("hasAuthority('crm.customer.manage')")
    public void delete(@PathVariable UUID id) {
        customerService.delete(id);
    }
}
