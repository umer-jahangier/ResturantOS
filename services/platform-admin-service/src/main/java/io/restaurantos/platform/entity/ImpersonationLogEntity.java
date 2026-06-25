package io.restaurantos.platform.entity;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;

import java.time.Instant;
import java.util.UUID;

/**
 * Audit trail for SuperAdmin impersonation sessions (PLATFORM-05).
 * NOT tenant-scoped — platform_db has no RLS (SC4/PLATFORM-07).
 */
@Entity
@Table(name = "impersonation_log")
@Getter
@Setter
public class ImpersonationLogEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "platform_user_id", nullable = false)
    private UUID platformUserId;

    @Column(name = "tenant_id", nullable = false)
    private UUID tenantId;

    @Column(name = "target_user_id", nullable = false)
    private UUID targetUserId;

    @Column(name = "started_at", nullable = false)
    private Instant startedAt = Instant.now();

    @Column(name = "ended_at")
    private Instant endedAt;

    @Column(length = 500)
    private String reason;
}
