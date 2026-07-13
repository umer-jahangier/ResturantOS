package io.restaurantos.pos.repository;

import io.restaurantos.pos.domain.enums.TillStatus;
import io.restaurantos.pos.domain.model.TillSession;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Repository
public interface TillSessionRepository extends JpaRepository<TillSession, UUID> {

    Optional<TillSession> findByCashierIdAndStatus(UUID cashierId, TillStatus status);

    Optional<TillSession> findByIdAndBranchId(UUID id, UUID branchId);

    List<TillSession> findByBranchIdAndStatus(UUID branchId, TillStatus status);

    /** Branch-wide till history (open + closed), newest first — admin till-review list. */
    List<TillSession> findByBranchIdOrderByOpenedAtDesc(UUID branchId);
}
