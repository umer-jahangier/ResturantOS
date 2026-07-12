package io.restaurantos.pos.domain.model;

import io.restaurantos.shared.entity.TenantAuditableEntity;
import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;

import java.util.UUID;

@Entity
@Table(name = "order_refunds")
@Getter
@Setter
public class OrderRefund extends TenantAuditableEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(name = "order_id", nullable = false)
    private UUID orderId;

    @Column(name = "refund_paisa", nullable = false)
    private long refundPaisa;

    @Column(name = "reason", nullable = false)
    private String reason;

    @Column(name = "refunded_by")
    private UUID refundedBy;

    @Column(name = "scope", nullable = false, length = 20)
    private String scope = "FULL";
}
