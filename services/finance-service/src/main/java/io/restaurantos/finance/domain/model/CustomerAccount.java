package io.restaurantos.finance.domain.model;

import io.restaurantos.finance.domain.enums.CustomerAccountStatus;
import io.restaurantos.shared.entity.TenantAuditableEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.Setter;

import java.util.UUID;

/**
 * Decision 10-17-A: the corporate/house account AR is sourced from — restaurants bill
 * corporate clients and regulars "on account", settled later (catering invoice, phone
 * order on account, month-end corporate billing).
 */
@Entity
@Table(name = "customer_accounts")
@Getter
@Setter
public class CustomerAccount extends TenantAuditableEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(name = "branch_id", nullable = false)
    private UUID branchId;

    @Column(name = "account_code", nullable = false, length = 30)
    private String accountCode;

    @Column(name = "name", nullable = false, length = 200)
    private String name;

    @Column(name = "contact_name", length = 200)
    private String contactName;

    @Column(name = "contact_phone", length = 30)
    private String contactPhone;

    @Column(name = "contact_email", length = 200)
    private String contactEmail;

    @Column(name = "credit_limit_paisa", nullable = false)
    private long creditLimitPaisa;

    @Column(name = "payment_terms_days", nullable = false)
    private int paymentTermsDays = 30;

    @Enumerated(EnumType.STRING)
    @Column(name = "status", nullable = false, length = 20)
    private CustomerAccountStatus status = CustomerAccountStatus.ACTIVE;

    @Column(name = "crm_customer_id")
    private UUID crmCustomerId;
}
