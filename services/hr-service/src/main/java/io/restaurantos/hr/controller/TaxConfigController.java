package io.restaurantos.hr.controller;

import io.restaurantos.hr.dto.TaxConfigDtos.CurrentFiscalYearResponse;
import io.restaurantos.hr.dto.TaxConfigDtos.SaveTaxConfigRequest;
import io.restaurantos.hr.dto.TaxConfigDtos.TaxConfigResponse;
import io.restaurantos.hr.dto.TaxConfigDtos.TaxConfigSummary;
import io.restaurantos.hr.payroll.tax.TaxConfigService;
import io.restaurantos.shared.api.ApiResponse;
import jakarta.validation.Valid;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/**
 * The tenant-managed tax table (D-35-05: HR is operable end to end without SQL).
 *
 * <p>Until this controller existed there was no HTTP path to {@code tax_config} at all — not a
 * read, not a write. The table's only row came from a Liquibase seed for a placeholder tenant and a
 * fiscal year that had already ended, so payroll refused for every real tenant and the documented
 * remedy was an INSERT typed by a developer. That is the specific thing D-35-05 forbids.
 *
 * <h2>Why PUT on a fiscal year and not POST to a collection</h2>
 *
 * <p>{@code uk_tax_config_tenant_fy} makes (tenant, fiscal year) the identity of a configuration:
 * a year has at most one. PUT on that identity is therefore create-or-replace, and it is
 * idempotent, which matters for a screen an accountant will save from twice while checking a
 * figure. A POST collection endpoint would let the second save collide with the first and surface
 * as a bare constraint violation with no field path.
 *
 * <h2>Reads on view, writes on manage</h2>
 *
 * <p>Both gates come from 35-03. {@code hr.config.manage} is enumerated to OWNER and TENANT_ADMIN
 * precisely so that a branch manager who can read the department list cannot rewrite the tax table;
 * this is the endpoint that distinction exists for. OPA is asked again inside
 * {@link TaxConfigService} — the {@code @PreAuthorize} is the coarse RBAC gate, the policy call is
 * what applies tenant scoping, and neither replaces the other.
 */
@RestController
@RequestMapping("/api/v1/hr/config/tax")
public class TaxConfigController {

    private final TaxConfigService taxConfigService;

    public TaxConfigController(TaxConfigService taxConfigService) {
        this.taxConfigService = taxConfigService;
    }

    /** Every fiscal year this tenant has configured, newest first. */
    @GetMapping
    @PreAuthorize("hasAuthority('hr.config.view')")
    public ApiResponse<List<TaxConfigSummary>> list() {
        return ApiResponse.ok(taxConfigService.list());
    }

    /**
     * Which fiscal year today falls in, and whether it is configured.
     *
     * <p>Mapped above {@code /{fiscalYear}} in this file for readability only — Spring prefers the
     * literal segment over the variable regardless of declaration order, so {@code /current} can
     * never be parsed as a year.
     */
    @GetMapping("/current")
    @PreAuthorize("hasAuthority('hr.config.view')")
    public ApiResponse<CurrentFiscalYearResponse> currentFiscalYear() {
        return ApiResponse.ok(taxConfigService.currentFiscalYear());
    }

    /** A year with no configuration answers {@code 409 TAX_CONFIG_NOT_CONFIGURED}, not an empty 200. */
    @GetMapping("/{fiscalYear}")
    @PreAuthorize("hasAuthority('hr.config.view')")
    public ApiResponse<TaxConfigResponse> get(@PathVariable int fiscalYear) {
        return ApiResponse.ok(taxConfigService.getByFiscalYear(fiscalYear));
    }

    /** Create or replace. A malformed slab table comes back naming each offending row. */
    @PutMapping("/{fiscalYear}")
    @PreAuthorize("hasAuthority('hr.config.manage')")
    public ApiResponse<TaxConfigResponse> save(@PathVariable int fiscalYear,
                                               @Valid @RequestBody SaveTaxConfigRequest req) {
        return ApiResponse.ok(taxConfigService.save(fiscalYear, req));
    }

    @PutMapping("/{fiscalYear}/active")
    @PreAuthorize("hasAuthority('hr.config.manage')")
    public ApiResponse<TaxConfigResponse> setActive(@PathVariable int fiscalYear,
                                                    @Valid @RequestBody ActiveRequest req) {
        return ApiResponse.ok(taxConfigService.setActive(fiscalYear, req.active()));
    }

    /**
     * Last year's figures as a draft for this one. <b>Nothing is written.</b>
     *
     * <p>GET, not POST, and that is the contract rather than a REST nicety: this endpoint has no
     * effect on the server, and a POST would invite a screen to treat it as "create next year".
     * See {@link TaxConfigService#copyForward} for why a silent carry-forward is how a superseded
     * statutory rate survives a Finance Act.
     */
    @GetMapping("/{fiscalYear}/draft-from")
    @PreAuthorize("hasAuthority('hr.config.manage')")
    public ApiResponse<SaveTaxConfigRequest> draftFrom(@PathVariable int fiscalYear,
                                                       @RequestParam int sourceFiscalYear) {
        return ApiResponse.ok(taxConfigService.copyForward(sourceFiscalYear, fiscalYear));
    }

    /** A body rather than a path segment, so deactivating is the same endpoint as activating. */
    public record ActiveRequest(boolean active) {
    }
}
