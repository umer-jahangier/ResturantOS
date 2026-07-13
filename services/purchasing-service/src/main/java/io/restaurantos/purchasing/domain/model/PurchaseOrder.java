package io.restaurantos.purchasing.domain.model;

import io.restaurantos.purchasing.domain.enums.PoStatus;
import io.restaurantos.shared.entity.TenantAuditableEntity;
import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;

import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

@Entity
@Table(name = "purchase_orders")
@Getter
@Setter
public class PurchaseOrder extends TenantAuditableEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(name = "vendor_id", nullable = false)
    private UUID vendorId;

    @Column(name = "branch_id", nullable = false)
    private UUID branchId;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 30)
    private PoStatus status = PoStatus.DRAFT;

    @Column(name = "expected_delivery_date")
    private LocalDate expectedDeliveryDate;

    @Column(name = "total_paisa", nullable = false)
    private long totalPaisa;

    @Column(columnDefinition = "TEXT")
    private String notes;

    @Column(name = "requester_id")
    private UUID requesterId;

    @Column(name = "submitted_at")
    private Instant submittedAt;

    @Column(name = "required_tiers", nullable = false)
    private int requiredTiers = 1;

    @Column(name = "tiers_approved", nullable = false)
    private int tiersApproved;

    @Column(name = "closed_at")
    private Instant closedAt;

    @Column(name = "closed_by")
    private UUID closedBy;

    @Column(name = "close_reason", columnDefinition = "TEXT")
    private String closeReason;

    @OneToMany(mappedBy = "purchaseOrder", cascade = CascadeType.ALL, orphanRemoval = true)
    private List<PurchaseOrderLine> lines = new ArrayList<>();
}
