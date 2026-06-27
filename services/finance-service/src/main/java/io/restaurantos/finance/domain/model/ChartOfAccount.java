package io.restaurantos.finance.domain.model;

import io.restaurantos.finance.domain.enums.AccountType;
import io.restaurantos.shared.entity.TenantAuditableEntity;
import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;

import java.util.UUID;

@Entity
@Table(
    name = "chart_of_accounts",
    uniqueConstraints = @UniqueConstraint(columnNames = {"tenant_id", "code"})
)
@Getter
@Setter
public class ChartOfAccount extends TenantAuditableEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(name = "code", nullable = false, length = 20)
    private String code;

    @Column(name = "name", nullable = false, length = 120)
    private String name;

    @Enumerated(EnumType.STRING)
    @Column(name = "account_type", nullable = false, length = 20)
    private AccountType accountType;

    @Column(name = "parent_code", length = 20)
    private String parentCode;

    @Column(name = "system", nullable = false)
    private boolean system;

    @Column(name = "system_tag", length = 60)
    private String systemTag;

    @Column(name = "active", nullable = false)
    private boolean active = true;
}
