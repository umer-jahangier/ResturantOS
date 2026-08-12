package io.restaurantos.pos.domain.model;

import io.restaurantos.pos.domain.enums.PaymentMethod;
import io.restaurantos.shared.entity.TenantAuditableEntity;
import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;

import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "order_payments")
@Getter
@Setter
public class OrderPayment extends TenantAuditableEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(name = "order_id", nullable = false)
    private UUID orderId;

    @Enumerated(EnumType.STRING)
    @Column(name = "method", nullable = false, length = 30)
    private PaymentMethod method;

    /** The amount APPLIED to the bill. Capped at the outstanding balance by PaymentServiceImpl —
     *  this is the number ORDER_CLOSED carries and finance debits, so it must never exceed the
     *  order total or the revenue journal entry cannot balance. */
    @Column(name = "amount_paisa", nullable = false)
    private long amountPaisa;

    /** What the customer actually handed over. Equals {@link #amountPaisa} for exact tender and
     *  for every non-cash method; larger for an over-tendered cash payment. */
    @Column(name = "tendered_paisa", nullable = false)
    private long tenderedPaisa;

    /**
     * Money taken ON TOP of the bill, for the staff (F20).
     *
     * <p>Deliberately NOT part of {@link #amountPaisa}, and therefore not part of
     * {@code orders.totalPaisa}: the order total is what the guest owes the restaurant, and a tip
     * is not owed and is not the restaurant's. Folding it in would credit staff money to sales
     * revenue and tax it as such. finance credits it to a Tips Payable LIABILITY instead.
     *
     * <p>It IS part of {@link #tenderedPaisa}, because the guest physically handed it over, and it
     * IS part of the drawer at till close for the same reason.
     */
    @Column(name = "tip_paisa", nullable = false)
    private long tipPaisa;

    /** {@code tenderedPaisa - amountPaisa - tipPaisa}. Cash back to the customer; 0 for non-cash. */
    @Column(name = "change_paisa", nullable = false)
    private long changePaisa;

    @Column(name = "reference_no", length = 100)
    private String referenceNo;

    @Column(name = "recorded_at")
    private Instant recordedAt;

    /**
     * Exact tender is the default. {@code PaymentServiceImpl} always sets both fields explicitly;
     * this only covers rows built directly — test fixtures, and any future writer that does not go
     * through the service — so a hand-constructed payment can never violate
     * {@code ck_order_payments_tender_covers_applied} by leaving {@code tenderedPaisa} at zero.
     *
     * <p>Deliberately does NOT clamp {@code amountPaisa}: over-application must stay impossible to
     * express, and the DB constraint is the backstop that says so.
     */
    @PrePersist
    void defaultTenderToAppliedAmount() {
        if (tenderedPaisa < amountPaisa + tipPaisa) {
            tenderedPaisa = amountPaisa + tipPaisa;
            changePaisa = 0L;
        }
    }
}
