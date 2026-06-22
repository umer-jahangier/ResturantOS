package io.restaurantos.shared.idempotency;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.Setter;

import java.time.Instant;

@Entity
@Table(name = "idempotency_keys")
@Getter
@Setter
public class IdempotencyKey {
    @Id @Column(name = "idem_key", length = 200) private String key;
    @Column(name = "request_hash", nullable = false, length = 64) private String requestHash;
    @Column(name = "status", nullable = false, length = 20) private String status; // IN_PROGRESS | COMPLETED
    @Column(name = "response_json", columnDefinition = "text") private String responseJson;
    @Column(name = "created_at", nullable = false) private Instant createdAt;
    @Column(name = "expires_at", nullable = false) private Instant expiresAt;
}
