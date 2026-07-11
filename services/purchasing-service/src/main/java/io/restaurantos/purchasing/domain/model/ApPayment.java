package io.restaurantos.purchasing.domain.model;

import io.restaurantos.shared.entity.TenantAuditableEntity;
import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

@Entity
@Table(name = "ap_payments")
@Getter
@Setter
public class ApPayment extends TenantAuditableEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(name = "vendor_id", nullable = false)
    private UUID vendorId;

    @Column(name = "branch_id", nullable = false)
    private UUID branchId;

    @Column(name = "payment_date", nullable = false)
    private LocalDate paymentDate;

    @Column(name = "amount_paisa", nullable = false)
    private long amountPaisa;

    @Column(name = "bank_account_code", nullable = false, length = 20)
    private String bankAccountCode = "1110";

    @Column(name = "idempotency_key", length = 120)
    private String idempotencyKey;

    @OneToMany(mappedBy = "payment", cascade = CascadeType.ALL, orphanRemoval = true)
    private List<ApPaymentAllocation> allocations = new ArrayList<>();
}
