package io.restaurantos.pos.domain.model;

import io.restaurantos.shared.entity.TenantAuditableEntity;
import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;

import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "till_review_actions")
@Getter
@Setter
public class TillReviewAction extends TenantAuditableEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(name = "till_session_id", nullable = false)
    private UUID tillSessionId;

    @Column(name = "reviewer_id", nullable = false)
    private UUID reviewerId;

    @Column(nullable = false, length = 20)
    private String action;

    @Column(columnDefinition = "TEXT")
    private String note;

    @Column(name = "acted_at", nullable = false)
    private Instant actedAt = Instant.now();
}
