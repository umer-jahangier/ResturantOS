package io.restaurantos.pos.domain.model;

import io.restaurantos.pos.domain.enums.PaymentMethod;
import io.restaurantos.shared.entity.TenantAuditableEntity;
import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;

import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "order_payments")
@Getter
@Setter
public class OrderPayment extends TenantAuditableEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(name = "order_id", nullable = false)
    private UUID orderId;

    @Enumerated(EnumType.STRING)
    @Column(name = "method", nullable = false, length = 30)
    private PaymentMethod method;

    @Column(name = "amount_paisa", nullable = false)
    private long amountPaisa;

    @Column(name = "reference_no", length = 100)
    private String referenceNo;

    @Column(name = "recorded_at")
    private Instant recordedAt;
}
