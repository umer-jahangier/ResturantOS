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
@Table(name = "loyalty_accounts")
@Getter
@Setter
public class LoyaltyAccountEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(name = "tenant_id", nullable = false)
    private UUID tenantId;

    @Column(name = "customer_id", nullable = false)
    private UUID customerId;

    @Column(name = "points_balance", nullable = false)
    private long pointsBalance;

    @Column(nullable = false, length = 20)
    private String tier = "BRONZE";

    @Column(name = "lifetime_spend_paisa", nullable = false)
    private long lifetimeSpendPaisa;
}
