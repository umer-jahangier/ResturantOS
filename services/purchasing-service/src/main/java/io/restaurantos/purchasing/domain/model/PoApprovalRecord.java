package io.restaurantos.purchasing.domain.model;

import io.restaurantos.shared.entity.TenantAuditableEntity;
import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;

import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "po_approval_records")
@Getter
@Setter
public class PoApprovalRecord extends TenantAuditableEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(name = "purchase_order_id", nullable = false)
    private UUID purchaseOrderId;

    @Column(nullable = false)
    private int tier;

    @Column(name = "approver_id", nullable = false)
    private UUID approverId;

    @Column(nullable = false, length = 20)
    private String action;

    @Column(columnDefinition = "TEXT")
    private String reason;

    @Column(name = "acted_at", nullable = false)
    private Instant actedAt = Instant.now();
}
