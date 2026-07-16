package io.restaurantos.reporting.dto;

import java.time.LocalDate;
import java.util.Map;
import java.util.UUID;

/**
 * Request body for {@code POST /api/v1/reporting/reports/{code}/run}.
 *
 * <p>Deliberately carries NO tenant-id field — tenant is ALWAYS resolved server-side from
 * {@code TenantContext.requireTenantId()}, never a request parameter (decision 10-10-B: "impossible
 * -by-construction tenant isolation, not just test coverage"). {@code branchId} is optional: an
 * OWNER-role caller may omit it (or pass {@code null}) to mean "all my branches"; every other
 * caller is validated against, and defaults to, their own JWT-issued branch — see
 * {@link io.restaurantos.reporting.service.ReportService}.
 */
public record ReportRequest(
        UUID branchId,
        LocalDate from,
        LocalDate to,
        Map<String, Object> params) {
}
