package io.restaurantos.inventory.domain.model;

import io.restaurantos.shared.entity.TenantAuditableEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.Setter;

import java.time.Instant;
import java.util.UUID;

/**
 * Maps to {@code stock_counts} (V1 migration, INV-06) — a stock-count header. {@code status}
 * mirrors the DB CHECK constraint: DRAFT, POSTED.
 */
@Entity
@Table(name = "stock_counts")
@Getter
@Setter
public class StockCount extends TenantAuditableEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(name = "branch_id", nullable = false)
    private UUID branchId;

    @Column(name = "status", nullable = false, length = 16)
    private String status = "DRAFT";

    @Column(name = "counted_at")
    private Instant countedAt;

    @Column(name = "posted_at")
    private Instant postedAt;
}
