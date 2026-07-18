package io.restaurantos.inventory.domain.model;

import io.restaurantos.shared.entity.TenantAuditableEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.Setter;

import java.math.BigDecimal;
import java.util.UUID;

/** Maps to {@code ingredients} (V1 migration). */
@Entity
@Table(name = "ingredients")
@Getter
@Setter
public class Ingredient extends TenantAuditableEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(name = "name", nullable = false, length = 160)
    private String name;

    @Column(name = "sku", length = 60)
    private String sku;

    @Column(name = "base_uom_code", nullable = false, length = 20)
    private String baseUomCode;

    @Column(name = "category", length = 80)
    private String category;

    @Column(name = "reorder_point", nullable = false, precision = 18, scale = 4)
    private BigDecimal reorderPoint = BigDecimal.ZERO;

    @Column(name = "is_active", nullable = false)
    private boolean active = true;
}
