package io.restaurantos.pos.domain.model;

import io.restaurantos.shared.entity.TenantAuditableEntity;
import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;

import java.math.BigDecimal;
import java.util.UUID;

@Entity
@Table(name = "order_discounts")
@Getter
@Setter
public class OrderDiscount extends TenantAuditableEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "order_id", nullable = false)
    private Order order;

    @Column(name = "order_item_id")
    private UUID orderItemId;

    @Column(name = "scope", nullable = false, length = 10)
    private String scope;

    @Column(name = "type", nullable = false, length = 10)
    private String type;

    @Column(name = "value", nullable = false, precision = 12, scale = 4)
    private BigDecimal value;

    @Column(name = "amount_paisa", nullable = false)
    private long amountPaisa = 0L;

    @Column(name = "applied_by")
    private UUID appliedBy;

    /**
     * WHY the money was given away. NOT NULL since V22 — see {@code ApplyDiscountRequest}. The
     * automatic promotion path writes its own system reason; there is no path that writes a row
     * without one.
     */
    @Column(name = "reason", nullable = false, length = 200)
    private String reason;

    /**
     * WHO gave it away, as a name, snapshotted at the moment of the discount.
     *
     * <p>A snapshot and not a join, for the same reason {@code itemNameSnapshot} is: the report
     * this feeds is read months later, and it must say who authorised the discount on the day —
     * not who happens to own that user id now, and not "—" because the person has since left and
     * their row was deactivated. {@code appliedBy} remains the machine-readable fact; this is the
     * human-readable one. Null only when the staff directory was unreachable at the time, in
     * which case every reader falls back to the id.
     */
    @Column(name = "applied_by_name", length = 200)
    private String appliedByName;
}
