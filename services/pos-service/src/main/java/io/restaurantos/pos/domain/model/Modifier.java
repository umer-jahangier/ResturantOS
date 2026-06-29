package io.restaurantos.pos.domain.model;

import io.restaurantos.shared.entity.TenantAuditableEntity;
import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;

import java.util.UUID;

@Entity
@Table(name = "modifiers")
@Getter
@Setter
public class Modifier extends TenantAuditableEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "modifier_group_id", nullable = false)
    private ModifierGroup modifierGroup;

    @Column(name = "name", nullable = false, length = 100)
    private String name;

    @Column(name = "price_delta_paisa", nullable = false)
    private long priceDeltaPaisa = 0L;

    @Column(name = "active", nullable = false)
    private boolean active = true;
}
