package io.restaurantos.platform.repository;

import io.restaurantos.platform.entity.PlatformUserEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.Optional;
import java.util.UUID;

@Repository
public interface PlatformUserRepository extends JpaRepository<PlatformUserEntity, UUID> {
    Optional<PlatformUserEntity> findByEmail(String email);
}
