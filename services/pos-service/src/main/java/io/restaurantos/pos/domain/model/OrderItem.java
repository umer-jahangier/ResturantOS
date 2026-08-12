package io.restaurantos.pos.domain.model;

import io.restaurantos.pos.domain.enums.OrderItemStatus;
import io.restaurantos.shared.entity.TenantAuditableEntity;
import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;

import java.math.BigDecimal;
import java.time.Instant;
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

    /**
     * Station SNAPSHOT captured at add-item time from the menu item's {@code station_id}
     * (Phase 3), alongside the retained {@link #kdsStation} free-text snapshot. Not an FK —
     * a point-in-time snapshot, mirroring kdsStation/menuItemId.
     */
    @Column(name = "station_id")
    private UUID stationId;

    @Enumerated(EnumType.STRING)
    @Column(name = "kds_status", nullable = false, length = 20)
    private OrderItemStatus itemStatus = OrderItemStatus.PENDING;

    @Column(name = "discount_paisa", nullable = false)
    private long discountPaisa = 0L;

    @Column(name = "tax_paisa", nullable = false)
    private long taxPaisa = 0L;

    /**
     * The tax rate, code and class name this line was CHARGED at, frozen at add-item time (F16).
     *
     * <p>Snapshots for the same reason {@link #unitPriceSnapshot} and {@link #itemNameSnapshot}
     * are: the bill has to keep saying what the guest actually paid. Before these existed, the
     * receipt's tax breakdown re-read the live {@code menu_items} row at print time, so a reprint
     * after a rate change attributed old money to a new rate, and an item since re-classified
     * moved its tax into a bucket it had never paid into.
     *
     * <p>A row with {@code taxPaisa > 0} and {@code taxRatePct == 0} is a PRE-F16 line: it was
     * written before the snapshot existed and its rate is genuinely unknown. That combination is
     * impossible for a new line — the tax is computed FROM the rate — which is what makes it a
     * safe discriminator for the receipt assembler's legacy fallback.
     */
    @Column(name = "tax_rate_pct", nullable = false, precision = 5, scale = 2)
    private BigDecimal taxRatePct = BigDecimal.ZERO;

    @Column(name = "tax_rate_code", length = 40)
    private String taxRateCode;

    @Column(name = "tax_class_name", length = 120)
    private String taxClassName;

    @Column(name = "line_total_paisa", nullable = false)
    private long lineTotalPaisa = 0L;

    @Column(name = "notes")
    private String notes;

    @Column(name = "revision_no", nullable = false)
    private int revisionNo = 0; // 0 = not yet fired; set at sendToKds time

    @Column(name = "fired_at")
    private Instant firedAt;

    @OneToMany(mappedBy = "orderItem", cascade = CascadeType.ALL, orphanRemoval = true)
    private List<OrderItemModifier> modifiers = new ArrayList<>();
}
