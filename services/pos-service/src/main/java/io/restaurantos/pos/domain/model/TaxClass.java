package io.restaurantos.pos.domain.model;

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

/**
 * One sales-tax rate in the tenant's catalogue (F16).
 *
 * <p>A class is three things a person can name: the authority's {@code code} (what a return
 * files under), a {@code name} (what a manager recognises on a dropdown and what the guest's
 * bill prints), and the {@code ratePct} itself. Nothing here is branch-scoped — a sales-tax
 * rate is a jurisdiction fact for the tenant, not equipment in a building.
 *
 * <p>{@code ratePct} is {@code BigDecimal}, never a double, for the reason every rate in this
 * codebase is: it is multiplied by paisa and rounded HALF_UP by
 * {@code OrderPricingCalculator.perLineTax}, and a binary-float 17.5 would put the rounding
 * boundary in the wrong place on some checks and not others.
 */
@Entity
@Table(name = "tax_classes")
@Getter
@Setter
public class TaxClass extends TenantAuditableEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(name = "code", nullable = false, length = 40)
    private String code;

    @Column(name = "name", nullable = false, length = 120)
    private String name;

    @Column(name = "rate_pct", nullable = false, precision = 5, scale = 2)
    private BigDecimal ratePct = BigDecimal.ZERO;

    @Column(name = "active", nullable = false)
    private boolean active = true;
}
