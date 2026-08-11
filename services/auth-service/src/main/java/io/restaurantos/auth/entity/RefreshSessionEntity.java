package io.restaurantos.auth.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.Setter;

import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "refresh_sessions")
@Getter
@Setter
public class RefreshSessionEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(name = "tenant_id", nullable = false)
    private UUID tenantId;

    /**
     * {@code TENANT} or {@code PLATFORM} (16b-01). The discriminator {@code AuthServiceImpl.refresh}
     * branches on to decide which KIND of token this session may mint.
     *
     * <p>Defaulted here as well as in the column definition so an entity constructed in code and
     * never passed through {@link io.restaurantos.auth.service.RefreshSessionService} still carries
     * the safe value. {@code chk_refresh_sessions_scope} (changeset 084) additionally binds this to
     * {@code tenant_id}, so a row whose scope and tenant disagree cannot be stored at all.
     */
    @Column(name = "scope", nullable = false)
    private String scope = RefreshScope.TENANT;

    @Column(name = "user_id", nullable = false)
    private UUID userId;

    @Column(name = "token_hash", nullable = false)
    private String tokenHash;

    @Column(name = "branch_id")
    private UUID branchId;

    @Column(name = "expires_at", nullable = false)
    private Instant expiresAt;

    @Column(name = "revoked_at")
    private Instant revokedAt;

    @Column(name = "user_agent")
    private String userAgent;

    private String ip;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;
}
