package io.restaurantos.pos.service;

import io.restaurantos.pos.dto.OrderSummaryDto;
import io.restaurantos.shared.tenant.TenantContext;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Who took the check — as a name, on every row of Order Management.
 *
 * <h2>The defect this closes</h2>
 *
 * <p>The Server/Cashier column rendered {@code cashierId.slice(0, 8)}. A manager scanning the
 * order list all day read {@code bc0d9897} where a person's name belongs, while the SAME table's
 * Voided column, in the SAME row, printed "by Shift Cashier 984155" — the name was already being
 * resolved a few pixels away and then thrown away for this column.
 *
 * <p>It could not be fixed in the browser. {@code GET /api/v1/users} is gated on the tenant
 * user-administration permission and answers 403 for a branch manager (measured — see
 * {@link io.restaurantos.pos.feign.AuthUserDirectoryClient}). Resolving the name here keeps the
 * answer inside {@code pos.order.view}, which the caller already holds, instead of widening a
 * permission to make a column render.
 *
 * <h2>Why this one DOES run on the hot path</h2>
 *
 * <p>Unlike {@link OrderSettlementDetailService}, which only touches terminal rows, every row has
 * a cashier, so this pass runs on the active list too. It costs no query and no network on a warm
 * cache: {@link StaffNameDirectory} de-duplicates by user id and holds a 5-minute TTL, and one
 * branch runs a handful of cashiers per shift. A cold cache costs one internal lookup per DISTINCT
 * cashier on the page, not one per row.
 *
 * <p>When a lookup fails the row keeps a null {@code cashierName} and the client falls back to the
 * id. That is deliberate and is the whole contract: the id is the fact, the name is decoration,
 * and a directory outage must degrade to the id — never to a blank, which reads as "nobody took
 * this check".
 */
@Service
public class OrderCashierNameService {

    private final StaffNameDirectory staffNameDirectory;
    private final TenantContext tenantContext;

    public OrderCashierNameService(StaffNameDirectory staffNameDirectory,
                                   TenantContext tenantContext) {
        this.staffNameDirectory = staffNameDirectory;
        this.tenantContext = tenantContext;
    }

    /** The same rows back, each carrying its cashier's display name where one could be resolved. */
    public List<OrderSummaryDto> withCashierNames(List<OrderSummaryDto> rows) {
        if (rows == null || rows.isEmpty()) {
            return rows;
        }

        List<UUID> cashierIds = rows.stream()
                .map(OrderSummaryDto::cashierId)
                .filter(java.util.Objects::nonNull)
                .distinct()
                .toList();
        if (cashierIds.isEmpty()) {
            return rows;
        }

        UUID tenantId = tenantContext.requireTenantId();
        Map<UUID, String> nameById = staffNameDirectory.resolveAll(tenantId, cashierIds);
        if (nameById.isEmpty()) {
            return rows;
        }

        return rows.stream()
                .map(row -> {
                    String name = row.cashierId() == null ? null : nameById.get(row.cashierId());
                    return name == null ? row : row.withCashierName(name);
                })
                .toList();
    }
}
