package io.restaurantos.pos.domain.model;

import io.restaurantos.pos.domain.enums.KdsItemStatus;
import io.restaurantos.shared.entity.TenantAuditableEntity;
import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

@Entity
@Table(name = "order_items")
@Getter
@Setter
public class OrderItem extends TenantAuditableEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "order_id", nullable = false)
    private Order order;

    @Column(name = "menu_item_id", nullable = false)
    private UUID menuItemId;

    @Column(name = "item_name_snapshot", nullable = false, length = 150)
    private String itemNameSnapshot;

    @Column(name = "unit_price_snapshot", nullable = false)
    private long unitPriceSnapshot;

    @Column(name = "quantity", nullable = false)
    private int quantity = 1;

    @Column(name = "kds_station")
    private String kdsStation;

    @Enumerated(EnumType.STRING)
    @Column(name = "kds_status", nullable = false, length = 20)
    private KdsItemStatus kdsStatus = KdsItemStatus.PENDING;

    @Column(name = "discount_paisa", nullable = false)
    private long discountPaisa = 0L;

    @Column(name = "tax_paisa", nullable = false)
    private long taxPaisa = 0L;

    @Column(name = "line_total_paisa", nullable = false)
    private long lineTotalPaisa = 0L;

    @Column(name = "notes")
    private String notes;

    @OneToMany(mappedBy = "orderItem", cascade = CascadeType.ALL, orphanRemoval = true)
    private List<OrderItemModifier> modifiers = new ArrayList<>();
}
