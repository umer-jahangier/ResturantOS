package io.restaurantos.shared.integration;

import io.restaurantos.shared.entity.TenantAuditableEntity;
import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;

import java.util.UUID;

/**
 * Test-only JPA entity mapping the widgets table created by test-changelog.xml.
 * Extends TenantAuditableEntity to inherit the Hibernate tenantFilter definition
 * and audit columns — used by SC4 RLS-or-fail guard test.
 */
@Entity
@Table(name = "widgets")
@Getter
@Setter
public class Widget extends TenantAuditableEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(nullable = false)
    private String name;

    @Column(name = "amount_paisa")
    private Long amountPaisa;
}
