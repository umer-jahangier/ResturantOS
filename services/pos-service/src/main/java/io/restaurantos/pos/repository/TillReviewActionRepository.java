package io.restaurantos.pos.repository;

import io.restaurantos.pos.domain.model.TillReviewAction;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.UUID;

@Repository
public interface TillReviewActionRepository extends JpaRepository<TillReviewAction, UUID> {

    List<TillReviewAction> findByTillSessionIdOrderByActedAtDesc(UUID tillSessionId);
}
