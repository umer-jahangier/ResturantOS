package io.restaurantos.auth.repository;

import io.restaurantos.auth.entity.PasswordHistoryEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.UUID;

@Repository
public interface PasswordHistoryRepository extends JpaRepository<PasswordHistoryEntity, UUID> {
    List<PasswordHistoryEntity> findTop5ByUserIdOrderByCreatedAtDesc(UUID userId);
}
