package io.restaurantos.crm.controller;

import io.restaurantos.crm.dto.CrmDtos.CreateCustomerRequest;
import io.restaurantos.crm.dto.CrmDtos.CustomerResponse;
import io.restaurantos.crm.dto.CrmDtos.UpdateCustomerRequest;
import io.restaurantos.crm.service.CustomerService;
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
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.util.UUID;

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
    public CustomerResponse create(@Valid @RequestBody CreateCustomerRequest req) {
        return customerService.create(req);
    }

    @GetMapping
    @PreAuthorize("hasAuthority('crm.customer.view')")
    public Page<CustomerResponse> list(Pageable pageable) {
        return customerService.list(pageable);
    }

    @GetMapping("/{id}")
    @PreAuthorize("hasAuthority('crm.customer.view')")
    public CustomerResponse get(@PathVariable UUID id) {
        return customerService.getById(id);
    }

    @PutMapping("/{id}")
    @PreAuthorize("hasAuthority('crm.customer.manage')")
    public CustomerResponse update(@PathVariable UUID id, @RequestBody UpdateCustomerRequest req) {
        return customerService.update(id, req);
    }

    @DeleteMapping("/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @PreAuthorize("hasAuthority('crm.customer.manage')")
    public void delete(@PathVariable UUID id) {
        customerService.delete(id);
    }
}
