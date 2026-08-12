package io.restaurantos.pos.domain.model;

import io.restaurantos.pos.domain.enums.PaymentMethod;
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

    /**
     * The tender this row reverses (S0-01, V20). One {@code OrderRefund} row is written per
     * ORIGINAL payment method the refund consumes, so a Rs 500 refund against a CASH 300 +
     * CARD 200 bill writes two rows, not one — which is what lets the till subtract only the
     * cash that actually left the drawer.
     *
     * <p>NULL only on rows written before V20; readers treat NULL as CASH (see the migration).
     */
    @Enumerated(EnumType.STRING)
    @Column(name = "method", length = 30)
    private PaymentMethod method;
}
