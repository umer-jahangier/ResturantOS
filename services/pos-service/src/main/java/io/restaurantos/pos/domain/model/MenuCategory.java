package io.restaurantos.pos.domain.model;

import io.restaurantos.shared.entity.TenantAuditableEntity;
import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

@Entity
@Table(name = "menu_categories")
@Getter
@Setter
public class MenuCategory extends TenantAuditableEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(name = "name", nullable = false, length = 100)
    private String name;

    @Column(name = "description")
    private String description;

    @Column(name = "sort_order", nullable = false)
    private int sortOrder = 0;

    @Column(name = "active", nullable = false)
    private boolean active = true;

    /**
     * The sales-tax class every item in this category inherits (F16). NULL = no category rule.
     *
     * <p>A raw id rather than a {@code @ManyToOne}: nothing here ever needs to walk to the class,
     * and {@link io.restaurantos.pos.service.TaxClassResolver} loads it once per resolution
     * instead of pulling a proxy through every category read on the till's menu grid.
     */
    @Column(name = "tax_class_id")
    private UUID taxClassId;

    @OneToMany(mappedBy = "category", cascade = CascadeType.ALL, orphanRemoval = true)
    private List<MenuItem> items = new ArrayList<>();
}
