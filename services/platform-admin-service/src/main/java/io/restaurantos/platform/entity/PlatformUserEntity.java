package io.restaurantos.platform.entity;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;

import java.time.Instant;
import java.util.UUID;

/**
 * SuperAdmin / Support / Billing user in the platform control plane.
 * NOT tenant-scoped — platform_db has no RLS (SC4/PLATFORM-07).
 */
@Entity
@Table(name = "platform_users")
@Getter
@Setter
public class PlatformUserEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(nullable = false, unique = true)
    private String email;

    @Column(name = "password_hash", nullable = false)
    private String passwordHash;

    @Column(nullable = false, length = 30)
    @Enumerated(EnumType.STRING)
    private PlatformRole role;

    @Column(name = "is_active", nullable = false)
    private boolean active = true;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt = Instant.now();

    public enum PlatformRole {
        SUPER_ADMIN, SUPPORT, BILLING
    }
}
