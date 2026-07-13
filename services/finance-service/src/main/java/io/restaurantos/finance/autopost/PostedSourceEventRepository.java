package io.restaurantos.finance.autopost;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.UUID;

@Repository
public interface PostedSourceEventRepository extends JpaRepository<PostedSourceEventEntity, UUID> {

    boolean existsByTenantIdAndSourceTypeAndSourceId(UUID tenantId, String sourceType, UUID sourceId);
}
