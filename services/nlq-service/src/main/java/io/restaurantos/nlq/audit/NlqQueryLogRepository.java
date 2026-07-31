package io.restaurantos.nlq.audit;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.UUID;

public interface NlqQueryLogRepository extends JpaRepository<NlqQueryLogEntity, UUID> {
}
