package io.restaurantos.reporting.service;

import io.restaurantos.reporting.dto.FbrTaxSummaryDto;
import io.restaurantos.reporting.exception.InvalidReportRangeException;
import io.restaurantos.reporting.feign.UserInternalClient;
import io.restaurantos.shared.tenant.TenantContext;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * FBR (Federal Board of Revenue, Pakistan) Tax Summary — the one named report this phase must
 * prove end-to-end (12-05-PLAN.md). Output tax comes from {@code ORDER_CLOSED.taxPaisa} (POS,
 * Phase 7, shipped, landed in {@code sales_order_facts}); input tax comes from
 * {@code VENDOR_INVOICE_MATCHED} (Purchasing, Phase 10, shipped, landed in
 * {@code purchase_tax_facts}). No Phase-8 dependency.
 *
 * <p><b>Scope note:</b> this is a named INTERNAL report shaped for FBR bookkeeping. There is no
 * FBR/IRIS e-filing API integration anywhere in the specs and none is built here — say so plainly
 * so no one later assumes a filing pipeline exists.
 *
 * <p><b>Deviation from plan prose:</b> {@code purchase_tax_facts} has no {@code subtotal_paisa}
 * column (12-02-SUMMARY.md's documented gap — the real {@code VENDOR_INVOICE_MATCHED} payload
 * carries {@code amountPaisa}/{@code inputTaxPaisa} only, landed as {@code total_paisa}/
 * {@code input_tax_paisa}). {@code taxablePurchasesPaisa} is therefore derived as
 * {@code total_paisa - input_tax_paisa} (the invoice total net of its own input tax) rather than
 * summed from a column that does not exist.
 */
@Service
public class FbrTaxSummaryService {

    private static final Logger log = LoggerFactory.getLogger(FbrTaxSummaryService.class);
    private static final String REPORT_CODE = "fbr-tax-summary";
    private static final int MAX_RANGE_DAYS = 400;

    private final JdbcTemplate clickHouseJdbcTemplate;
    private final TenantContext tenantContext;
    private final UserInternalClient userInternalClient;
    private final ReportRunLogger reportRunLogger;

    public FbrTaxSummaryService(@Qualifier("clickHouseJdbcTemplate") JdbcTemplate clickHouseJdbcTemplate,
                                 TenantContext tenantContext,
                                 UserInternalClient userInternalClient,
                                 ReportRunLogger reportRunLogger) {
        this.clickHouseJdbcTemplate = clickHouseJdbcTemplate;
        this.tenantContext = tenantContext;
        this.userInternalClient = userInternalClient;
        this.reportRunLogger = reportRunLogger;
    }

    public FbrTaxSummaryDto summary(UUID branchId, LocalDate from, LocalDate to) {
        if (branchId == null) {
            throw new InvalidReportRangeException("branchId is required for the FBR Tax Summary");
        }
        validateRange(from, to);
        UUID tenantId = tenantContext.requireTenantId();

        long startNanos = System.nanoTime();

        Map<String, Object> salesRow = clickHouseJdbcTemplate.queryForMap(
                """
                SELECT count() AS order_count, sum(subtotal_paisa) AS taxable_sales_paisa,
                       sum(tax_paisa) AS output_tax_paisa
                FROM clickhouse_analytics.sales_order_facts
                WHERE tenant_id = ? AND branch_id = ? AND business_date BETWEEN ? AND ?
                """,
                tenantId, branchId, from, to);

        Map<String, Object> purchaseRow = clickHouseJdbcTemplate.queryForMap(
                """
                SELECT count() AS invoice_count, sum(input_tax_paisa) AS input_tax_paisa,
                       sum(total_paisa - input_tax_paisa) AS taxable_purchases_paisa
                FROM clickhouse_analytics.purchase_tax_facts
                WHERE tenant_id = ? AND branch_id = ? AND business_date BETWEEN ? AND ?
                """,
                tenantId, branchId, from, to);

        long outputTaxPaisa = asLong(salesRow.get("output_tax_paisa"));
        long taxableSalesPaisa = asLong(salesRow.get("taxable_sales_paisa"));
        long salesOrderCount = asLong(salesRow.get("order_count"));

        long inputTaxPaisa = asLong(purchaseRow.get("input_tax_paisa"));
        long taxablePurchasesPaisa = asLong(purchaseRow.get("taxable_purchases_paisa"));
        long purchaseInvoiceCount = asLong(purchaseRow.get("invoice_count"));

        // Never clamp — a negative net payable is a legitimate refundable input-tax credit.
        // Silently flooring a refund to zero would be a financial misstatement.
        long netPayablePaisa = outputTaxPaisa - inputTaxPaisa;

        List<String> dataNotes = new ArrayList<>();
        String branchName = null;
        String ntn = null;
        String fbrStrn = null;
        try {
            UserInternalClient.BranchInternalDto branch = userInternalClient.getBranch(branchId);
            if (branch != null) {
                branchName = branch.name();
                ntn = branch.ntn();
                fbrStrn = branch.fbrStrn();
            }
        } catch (Exception e) {
            // The tax figures are the point of this report; a missing header degrades it, it does
            // not fail it. If this ever 401s/503s in production the almost-certain cause is a
            // missing JWT forward in FeignClientConfig — see 12-05-PLAN.md Task 2 and the
            // commit-990026a precedent (that exact bug took down every PO approval in Phase 10 and
            // was invisible to ITs that stub the client, as this service's own FbrTaxSummaryIT
            // does).
            log.warn("FBR header lookup failed for branchId={}: {}", branchId, e.getMessage());
            dataNotes.add("Branch NTN/STRN header unavailable (user-service unreachable) — tax figures below are unaffected");
        }

        long durationMs = (System.nanoTime() - startNanos) / 1_000_000L;

        reportRunLogger.log(tenantId, branchId, REPORT_CODE,
                Map.of("from", from.toString(), "to", to.toString()),
                (int) (salesOrderCount + purchaseInvoiceCount), durationMs,
                tenantContext.getUserId().orElse(null));

        return new FbrTaxSummaryDto(branchId, branchName, ntn, fbrStrn, from, to,
                outputTaxPaisa, taxableSalesPaisa, inputTaxPaisa, taxablePurchasesPaisa,
                netPayablePaisa, salesOrderCount, purchaseInvoiceCount, durationMs, dataNotes);
    }

    private void validateRange(LocalDate from, LocalDate to) {
        if (from == null || to == null) {
            throw new InvalidReportRangeException("'from' and 'to' are required");
        }
        if (from.isAfter(to)) {
            throw new InvalidReportRangeException("'from' must not be after 'to'");
        }
        long days = ChronoUnit.DAYS.between(from, to);
        if (days > MAX_RANGE_DAYS) {
            throw new InvalidReportRangeException(
                    "date range spans " + days + " days, exceeding the max of " + MAX_RANGE_DAYS);
        }
    }

    private static long asLong(Object value) {
        return value == null ? 0L : ((Number) value).longValue();
    }
}
