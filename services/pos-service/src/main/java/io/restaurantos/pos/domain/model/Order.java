package io.restaurantos.pos.domain.model;

import io.restaurantos.pos.domain.enums.DerivedOrderStatus;
import io.restaurantos.pos.domain.enums.OrderStatus;
import io.restaurantos.pos.domain.enums.OrderType;
import io.restaurantos.shared.entity.TenantAuditableEntity;
import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

@Entity
@Table(name = "orders")
@Getter
@Setter
public class Order extends TenantAuditableEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(name = "branch_id", nullable = false)
    private UUID branchId;

    @Column(name = "order_no", length = 30)
    private String orderNo;

    @Enumerated(EnumType.STRING)
    @Column(name = "type", nullable = false, length = 20)
    private OrderType type = OrderType.DINE_IN;

    @Enumerated(EnumType.STRING)
    @Column(name = "status", nullable = false, length = 20)
    private OrderStatus status = OrderStatus.DRAFT;

    @Enumerated(EnumType.STRING)
    @Column(name = "derived_status", nullable = false, length = 20)
    private DerivedOrderStatus derivedStatus = DerivedOrderStatus.DRAFT;

    @Column(name = "table_id")
    private UUID tableId;

    @Column(name = "cover_count", nullable = false)
    private int coverCount = 1;

    @Column(name = "cashier_id")
    private UUID cashierId;

    @Column(name = "till_session_id")
    private UUID tillSessionId;

    @Column(name = "customer_id")
    private UUID customerId;

    @Column(name = "subtotal_paisa", nullable = false)
    private long subtotalPaisa = 0L;

    @Column(name = "tax_paisa", nullable = false)
    private long taxPaisa = 0L;

    @Column(name = "discount_paisa", nullable = false)
    private long discountPaisa = 0L;

    @Column(name = "service_charge_paisa", nullable = false)
    private long serviceChargePaisa = 0L;

    @Column(name = "total_paisa", nullable = false)
    private long totalPaisa = 0L;

    @Column(name = "notes")
    private String notes;

    @Column(name = "opened_at")
    private Instant openedAt;

    @Column(name = "sent_to_kds_at")
    private Instant sentToKdsAt;

    @Column(name = "closed_at")
    private Instant closedAt;

    @Column(name = "voided_at")
    private Instant voidedAt;

    @Column(name = "void_reason")
    private String voidReason;

    @Column(name = "client_order_id", nullable = false, unique = true)
    private UUID clientOrderId;

    @Version
    @Column(name = "version", nullable = false)
    private long version = 0L;

    @OneToMany(mappedBy = "order", cascade = CascadeType.ALL, orphanRemoval = true)
    private List<OrderItem> items = new ArrayList<>();

    @OneToMany(mappedBy = "order", cascade = CascadeType.ALL, orphanRemoval = true)
    private List<OrderDiscount> discounts = new ArrayList<>();
}
