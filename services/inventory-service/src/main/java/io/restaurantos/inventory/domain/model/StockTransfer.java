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
 * Maps to {@code stock_transfers} (V1 migration, INV-05) — an inter-branch stock transfer header.
 * {@code status} mirrors the DB CHECK constraint: SHIPPED, RECEIVED, CANCELLED.
 */
@Entity
@Table(name = "stock_transfers")
@Getter
@Setter
public class StockTransfer extends TenantAuditableEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(name = "from_branch_id", nullable = false)
    private UUID fromBranchId;

    @Column(name = "to_branch_id", nullable = false)
    private UUID toBranchId;

    @Column(name = "status", nullable = false, length = 16)
    private String status = "SHIPPED";

    @Column(name = "shipped_at")
    private Instant shippedAt;

    @Column(name = "received_at")
    private Instant receivedAt;
}
