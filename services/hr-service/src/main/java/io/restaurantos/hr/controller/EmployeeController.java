package io.restaurantos.hr.controller;

import io.restaurantos.hr.dto.EmployeeDtos.CreateEmployeeRequest;
import io.restaurantos.hr.dto.EmployeeDtos.EmployeeResponse;
import io.restaurantos.hr.dto.EmployeeDtos.UpdateEmployeeRequest;
import io.restaurantos.hr.service.EmployeeService;
import io.restaurantos.shared.api.ApiResponse;
import jakarta.validation.Valid;
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

import java.util.List;
import java.util.UUID;

/**
 * Employee CRUD, permission-gated. Responses are {@link ApiResponse}-wrapped like every other
 * service. View endpoints need {@code hr.employee.view}; mutations need {@code hr.employee.manage}.
 */
@RestController
@RequestMapping("/api/v1/hr/employees")
public class EmployeeController {

    private final EmployeeService employeeService;

    public EmployeeController(EmployeeService employeeService) {
        this.employeeService = employeeService;
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    @PreAuthorize("hasAuthority('hr.employee.manage')")
    public ApiResponse<EmployeeResponse> create(@Valid @RequestBody CreateEmployeeRequest req) {
        return ApiResponse.ok(employeeService.create(req));
    }

    @GetMapping
    @PreAuthorize("hasAuthority('hr.employee.view')")
    public ApiResponse<List<EmployeeResponse>> list() {
        return ApiResponse.ok(employeeService.list());
    }

    @GetMapping("/{id}")
    @PreAuthorize("hasAuthority('hr.employee.view')")
    public ApiResponse<EmployeeResponse> get(@PathVariable UUID id) {
        return ApiResponse.ok(employeeService.get(id));
    }

    @PutMapping("/{id}")
    @PreAuthorize("hasAuthority('hr.employee.manage')")
    public ApiResponse<EmployeeResponse> update(@PathVariable UUID id,
                                                @Valid @RequestBody UpdateEmployeeRequest req) {
        return ApiResponse.ok(employeeService.update(id, req));
    }

    @DeleteMapping("/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @PreAuthorize("hasAuthority('hr.employee.manage')")
    public void deactivate(@PathVariable UUID id) {
        employeeService.deactivate(id);
    }
}
