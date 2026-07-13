package io.restaurantos.purchasing.domain.model;

import io.restaurantos.shared.entity.TenantAuditableEntity;
import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;

import java.util.UUID;

@Entity
@Table(name = "vendors")
@Getter
@Setter
public class Vendor extends TenantAuditableEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(nullable = false, length = 200)
    private String name;

    @Column(name = "contact_person", length = 120)
    private String contactPerson;

    @Column(length = 30)
    private String phone;

    @Column(length = 200)
    private String email;

    @Column(columnDefinition = "TEXT")
    private String address;

    @Column(name = "payment_terms", nullable = false, length = 20)
    private String paymentTerms = "NET30";

    @Column(length = 30)
    private String ntn;

    @Column(length = 30)
    private String strn;

    @Column(name = "lead_time_days")
    private Integer leadTimeDays;

    @Column(name = "bank_account_no", columnDefinition = "TEXT")
    private String bankAccountNo;

    @Column(name = "bank_account_last4", length = 4)
    private String bankAccountLast4;

    @Column(columnDefinition = "TEXT")
    private String notes;

    @Column(nullable = false)
    private boolean active = true;
}
