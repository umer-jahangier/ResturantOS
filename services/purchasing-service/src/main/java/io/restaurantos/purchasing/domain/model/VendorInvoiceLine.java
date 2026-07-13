package io.restaurantos.purchasing.domain.model;

import io.restaurantos.purchasing.domain.enums.LineMatchStatus;
import io.restaurantos.shared.entity.TenantAuditableEntity;
import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;

import java.math.BigDecimal;
import java.util.UUID;

@Entity
@Table(name = "vendor_invoice_lines")
@Getter
@Setter
public class VendorInvoiceLine extends TenantAuditableEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "invoice_id", nullable = false)
    private VendorInvoice invoice;

    @Column(name = "po_line_id", nullable = false)
    private UUID poLineId;

    @Column(nullable = false, precision = 18, scale = 4)
    private BigDecimal qty;

    @Column(name = "unit_price_paisa", nullable = false)
    private long unitPricePaisa;

    @Column(name = "line_total_paisa", nullable = false)
    private long lineTotalPaisa;

    @Enumerated(EnumType.STRING)
    @Column(name = "match_status", nullable = false, length = 30)
    private LineMatchStatus matchStatus = LineMatchStatus.PENDING;
}
