package io.restaurantos.purchasing.repository;

import io.restaurantos.purchasing.domain.model.Vendor;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.UUID;

public interface VendorRepository extends JpaRepository<Vendor, UUID> {

    Page<Vendor> findByNameContainingIgnoreCase(String name, Pageable pageable);

    boolean existsByTenantIdAndNameIgnoreCase(UUID tenantId, String name);
}
