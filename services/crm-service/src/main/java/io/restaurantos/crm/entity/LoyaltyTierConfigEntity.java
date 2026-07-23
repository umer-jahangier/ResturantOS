package io.restaurantos.crm.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.Setter;

import java.util.UUID;

@Entity
@Table(name = "loyalty_tier_config")
@Getter
@Setter
public class LoyaltyTierConfigEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(name = "tenant_id", nullable = false)
    private UUID tenantId;

    @Column(nullable = false, length = 20)
    private String tier;

    @Column(name = "min_lifetime_spend_paisa", nullable = false)
    private long minLifetimeSpendPaisa;

    /** Paisa spent per 1 loyalty point (100 = 1 point per PKR 1). */
    @Column(name = "points_per_pkr_paisa", nullable = false)
    private long pointsPerPkrPaisa;
}
