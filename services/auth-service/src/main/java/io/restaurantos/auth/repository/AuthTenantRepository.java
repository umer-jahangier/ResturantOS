package io.restaurantos.auth.repository;

import io.restaurantos.auth.entity.AuthTenantEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.Optional;
import java.util.UUID;

@Repository
public interface AuthTenantRepository extends JpaRepository<AuthTenantEntity, UUID> {
    Optional<AuthTenantEntity> findBySlug(String slug);
}
