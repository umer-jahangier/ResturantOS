package io.restaurantos.reporting.controller;

import io.restaurantos.reporting.dto.FbrTaxSummaryDto;
import io.restaurantos.reporting.dto.ReportRequest;
import io.restaurantos.reporting.dto.ReportResultDto;
import io.restaurantos.reporting.report.ReportDefinition;
import io.restaurantos.reporting.service.FbrTaxSummaryService;
import io.restaurantos.reporting.service.ReportService;
import io.restaurantos.shared.api.ApiResponse;
import jakarta.validation.Valid;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

/**
 * REST surface for the 12-05 named reports + FBR Tax Summary. Follows
 * {@code PurchaseOrderController}'s conventions: the {@code ApiResponse<T>} envelope,
 * {@code @PreAuthorize}, server-derived tenantId (never a request field — see
 * {@link ReportService}/{@link FbrTaxSummaryService}), {@code branchId} as an optional request
 * param.
 *
 * <p>Permissions ({@code reporting.report.view} / {@code reporting.report.fbr}) are seeded and
 * granted by 12-11 (wave 1, already landed) — this controller only references the codes.
 */
@RestController
@RequestMapping("/api/v1/reporting/reports")
public class ReportController {

    private final ReportService reportService;
    private final FbrTaxSummaryService fbrTaxSummaryService;

    public ReportController(ReportService reportService, FbrTaxSummaryService fbrTaxSummaryService) {
        this.reportService = reportService;
        this.fbrTaxSummaryService = fbrTaxSummaryService;
    }

    @GetMapping
    @PreAuthorize("hasAuthority('reporting.report.view')")
    public ApiResponse<List<ReportDefinition>> list() {
        return ApiResponse.ok(reportService.listReports());
    }

    @PostMapping("/{code}/run")
    @PreAuthorize("hasAuthority('reporting.report.view')")
    public ApiResponse<ReportResultDto> run(@PathVariable String code,
                                             @Valid @RequestBody ReportRequest request) {
        return ApiResponse.ok(reportService.run(code, request));
    }

    /**
     * The tax report is a distinct, more sensitive grant than the general report catalog —
     * {@code reporting.report.fbr}, not {@code reporting.report.view}.
     */
    @GetMapping("/fbr-tax-summary")
    @PreAuthorize("hasAuthority('reporting.report.fbr')")
    public ApiResponse<FbrTaxSummaryDto> fbrTaxSummary(
            @RequestParam UUID branchId,
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to) {
        return ApiResponse.ok(fbrTaxSummaryService.summary(branchId, from, to));
    }
}
