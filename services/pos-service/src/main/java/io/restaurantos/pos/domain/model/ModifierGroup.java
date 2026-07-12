package io.restaurantos.pos.domain.model;

import io.restaurantos.shared.entity.TenantAuditableEntity;
import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

@Entity
@Table(name = "modifier_groups")
@Getter
@Setter
public class ModifierGroup extends TenantAuditableEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "menu_item_id", nullable = false)
    private MenuItem menuItem;

    @Column(name = "name", nullable = false, length = 100)
    private String name;

    @Column(name = "required", nullable = false)
    private boolean required = false;

    @Column(name = "min_select", nullable = false)
    private int minSelect = 0;

    @Column(name = "max_select", nullable = false)
    private int maxSelect = 1;

    @OneToMany(mappedBy = "modifierGroup", cascade = CascadeType.ALL, orphanRemoval = true)
    private List<Modifier> modifiers = new ArrayList<>();
}
