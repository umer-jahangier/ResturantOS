package io.restaurantos.shared.event;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.UUID;

public interface OutboxRepository extends JpaRepository<OutboxEntry, UUID> {
    List<OutboxEntry> findTop200ByStatusOrderByCreatedAtAsc(String status);
}
