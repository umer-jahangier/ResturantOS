package io.restaurantos.nlq.allowlist;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface AllowedTableRepository extends JpaRepository<AllowedTableEntity, AllowedTableEntity.Key> {

    List<AllowedTableEntity> findByRoleCode(String roleCode);
}
