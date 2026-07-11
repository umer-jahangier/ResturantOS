package io.restaurantos.purchasing.domain.model;

import io.restaurantos.shared.entity.TenantAuditableEntity;
import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;

import java.util.UUID;

@Entity
@Table(name = "po_approval_tiers", uniqueConstraints = @UniqueConstraint(columnNames = {"tenant_id", "tier_no"}))
@Getter
@Setter
public class PoApprovalTier extends TenantAuditableEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(name = "tier_no", nullable = false)
    private int tierNo;

    @Column(name = "min_amount_paisa", nullable = false)
    private long minAmountPaisa;

    @Column(name = "max_amount_paisa")
    private Long maxAmountPaisa;

    @Column(name = "required_role", length = 60)
    private String requiredRole;
}
