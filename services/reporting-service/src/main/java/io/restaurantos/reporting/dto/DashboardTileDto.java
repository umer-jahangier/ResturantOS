package io.restaurantos.reporting.dto;

import java.time.Instant;
import java.time.LocalDate;

/**
 * A single dashboard KPI tile. A tile is either a MONEY value ({@code valuePaisa}) or a COUNT
 * ({@code valueNumber}) — exactly one of the two is populated, the other is left {@code null}
 * rather than defaulted to 0 (0 would be a lie: "zero revenue" and "not applicable" are different
 * facts).
 */
public record DashboardTileDto(
        String tileId,
        String title,
        Long valuePaisa,
        Long valueNumber,
        String unit,
        LocalDate businessDate,
        Instant computedAt
) {}
