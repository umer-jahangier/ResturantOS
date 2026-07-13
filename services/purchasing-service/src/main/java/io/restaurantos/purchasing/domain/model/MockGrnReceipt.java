package io.restaurantos.purchasing.domain.model;

import io.restaurantos.shared.entity.TenantAuditableEntity;
import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "mock_grn_receipts")
@Getter
@Setter
public class MockGrnReceipt extends TenantAuditableEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(name = "purchase_order_id", nullable = false)
    private UUID purchaseOrderId;

    @Column(name = "po_line_id", nullable = false)
    private UUID poLineId;

    @Column(name = "grn_id", nullable = false)
    private UUID grnId = UUID.randomUUID();

    @Column(name = "received_qty", nullable = false, precision = 18, scale = 4)
    private BigDecimal receivedQty;

    @Column(name = "received_at", nullable = false)
    private Instant receivedAt = Instant.now();

    @Column(name = "idempotency_key", length = 120)
    private String idempotencyKey;
}
