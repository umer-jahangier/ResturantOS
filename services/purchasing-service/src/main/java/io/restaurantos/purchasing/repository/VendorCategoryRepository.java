package io.restaurantos.purchasing.repository;

import io.restaurantos.purchasing.domain.model.VendorCategory;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.UUID;

public interface VendorCategoryRepository extends JpaRepository<VendorCategory, UUID> {

    List<VendorCategory> findByTenantIdAndVendorId(UUID tenantId, UUID vendorId);

    void deleteByTenantIdAndVendorId(UUID tenantId, UUID vendorId);

    List<VendorCategory> findByTenantIdAndCategoryId(UUID tenantId, UUID categoryId);
}
