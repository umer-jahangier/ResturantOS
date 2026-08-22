package io.restaurantos.platform.repository;

import io.restaurantos.platform.entity.SubscriptionPlanEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Repository
public interface SubscriptionPlanRepository extends JpaRepository<SubscriptionPlanEntity, UUID> {

    Optional<SubscriptionPlanEntity> findByCode(String code);

    boolean existsByCode(String code);

    /** Plans an operator can currently sell. Archived plans stay readable through {@link #findByCode}. */
    List<SubscriptionPlanEntity> findByActiveTrueOrderByPricePaisaAsc();

    List<SubscriptionPlanEntity> findAllByOrderByPricePaisaAsc();
}
