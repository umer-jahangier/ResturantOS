package io.restaurantos.hr.repository;

import io.restaurantos.hr.entity.PayslipEntity;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.UUID;

public interface PayslipRepository extends JpaRepository<PayslipEntity, UUID> {

    List<PayslipEntity> findAllByRunId(UUID runId);

    void deleteAllByRunId(UUID runId);
}
