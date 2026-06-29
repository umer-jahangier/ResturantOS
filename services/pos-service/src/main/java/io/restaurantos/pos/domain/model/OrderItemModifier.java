package io.restaurantos.pos.domain.model;

import io.restaurantos.shared.entity.TenantAuditableEntity;
import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;

import java.util.UUID;

@Entity
@Table(name = "order_item_modifiers")
@Getter
@Setter
public class OrderItemModifier extends TenantAuditableEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "order_item_id", nullable = false)
    private OrderItem orderItem;

    @Column(name = "modifier_id", nullable = false)
    private UUID modifierId;

    @Column(name = "modifier_name_snapshot", nullable = false, length = 100)
    private String modifierNameSnapshot;

    @Column(name = "price_delta_paisa", nullable = false)
    private long priceDeltaPaisa = 0L;
}
