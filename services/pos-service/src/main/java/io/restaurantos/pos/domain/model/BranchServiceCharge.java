package io.restaurantos.pos.domain.model;

import io.restaurantos.pos.domain.enums.OrderType;
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
 * One branch's service-charge policy (F20).
 *
 * <p>Branch-scoped, not tenant-scoped, unlike {@link TaxClass}: a sales-tax rate is a
 * jurisdiction fact that cannot differ between two dining rooms, whereas a service charge is a
 * commercial decision about one dining room's table service. A rooftop with waiters and a
 * takeaway counter in the same tenant should not be forced onto the same number.
 *
 * <p>{@code ratePct} is {@code BigDecimal} for the reason every rate in this codebase is: it is
 * multiplied by paisa and rounded HALF_UP, and a binary-float 12.5 would put the rounding
 * boundary in the wrong place on some checks and not others.
 */
@Entity
@Table(name = "branch_service_charge")
@Getter
@Setter
public class BranchServiceCharge extends TenantAuditableEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(name = "branch_id", nullable = false)
    private UUID branchId;

    @Column(name = "enabled", nullable = false)
    private boolean enabled = false;

    @Column(name = "rate_pct", nullable = false, precision = 5, scale = 2)
    private BigDecimal ratePct = BigDecimal.ZERO;

    @Column(name = "label", nullable = false, length = 60)
    private String label = "Service charge";

    @Column(name = "dine_in", nullable = false)
    private boolean dineIn = true;

    @Column(name = "takeaway", nullable = false)
    private boolean takeaway = false;

    @Column(name = "pickup", nullable = false)
    private boolean pickup = false;

    /**
     * Does this policy charge a check of this type?
     *
     * <p>The switch is exhaustive on purpose. A new {@link OrderType} — delivery, room service,
     * a channel that does not exist yet — must be a compile error here rather than silently
     * inheriting "no charge" or, far worse, "charge it". Which channels a service charge applies
     * to is a decision somebody has to make out loud.
     */
    public boolean appliesTo(OrderType type) {
        if (!enabled || type == null) {
            return false;
        }
        return switch (type) {
            case DINE_IN -> dineIn;
            case TAKEAWAY -> takeaway;
            case PICKUP -> pickup;
            case DELIVERY -> false;
        };
    }
}
