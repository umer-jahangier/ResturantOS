package io.restaurantos.purchasing.domain.model;

import io.restaurantos.purchasing.domain.enums.InvoiceStatus;
import io.restaurantos.shared.entity.TenantAuditableEntity;
import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;

import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

@Entity
@Table(name = "vendor_invoices")
@Getter
@Setter
public class VendorInvoice extends TenantAuditableEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(name = "vendor_id", nullable = false)
    private UUID vendorId;

    @Column(name = "purchase_order_id", nullable = false)
    private UUID purchaseOrderId;

    @Column(name = "branch_id", nullable = false)
    private UUID branchId;

    @Column(name = "invoice_no", nullable = false, length = 60)
    private String invoiceNo;

    @Column(name = "invoice_date", nullable = false)
    private LocalDate invoiceDate;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 30)
    private InvoiceStatus status = InvoiceStatus.PENDING_MATCH;

    @Column(name = "total_paisa", nullable = false)
    private long totalPaisa;

    @Column(name = "input_tax_paisa", nullable = false)
    private long inputTaxPaisa;

    @Column(name = "match_override_reason", columnDefinition = "TEXT")
    private String matchOverrideReason;

    @Column(name = "matched_at")
    private Instant matchedAt;

    @Column(name = "paid_at")
    private Instant paidAt;

    @OneToMany(mappedBy = "invoice", cascade = CascadeType.ALL, orphanRemoval = true)
    private List<VendorInvoiceLine> lines = new ArrayList<>();
}
