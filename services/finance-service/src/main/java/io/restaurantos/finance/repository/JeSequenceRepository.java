package io.restaurantos.finance.repository;

import io.restaurantos.finance.domain.model.JeSequence;
import io.restaurantos.finance.domain.model.JeSequenceId;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.Optional;
import java.util.UUID;

@Repository
public interface JeSequenceRepository extends JpaRepository<JeSequence, JeSequenceId> {

    @Modifying
    @Query("UPDATE JeSequence s SET s.lastSeq = s.lastSeq + 1 " +
           "WHERE s.tenantId = :tenantId AND s.fiscalYear = :fiscalYear")
    int increment(@Param("tenantId") UUID tenantId, @Param("fiscalYear") int fiscalYear);

    @Query("SELECT s.lastSeq FROM JeSequence s " +
           "WHERE s.tenantId = :tenantId AND s.fiscalYear = :fiscalYear")
    Optional<Integer> findLastSeq(@Param("tenantId") UUID tenantId,
                                  @Param("fiscalYear") int fiscalYear);
}
