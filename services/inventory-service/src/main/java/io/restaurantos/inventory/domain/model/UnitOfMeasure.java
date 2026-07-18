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

/** Maps to {@code units_of_measure} (V1 migration). */
@Entity
@Table(name = "units_of_measure")
@Getter
@Setter
public class UnitOfMeasure extends TenantAuditableEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(name = "code", nullable = false, length = 20)
    private String code;

    @Column(name = "name", nullable = false, length = 120)
    private String name;

    @Column(name = "base_unit_code", length = 20)
    private String baseUnitCode;

    @Column(name = "to_base_factor", nullable = false, precision = 18, scale = 8)
    private BigDecimal toBaseFactor = BigDecimal.ONE;
}
