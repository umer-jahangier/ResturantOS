package io.restaurantos.pos.repository;

import io.restaurantos.pos.domain.model.MenuCategory;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.UUID;

@Repository
public interface MenuCategoryRepository extends JpaRepository<MenuCategory, UUID> {

    @Query("SELECT c FROM MenuCategory c WHERE c.active = true ORDER BY c.sortOrder ASC")
    List<MenuCategory> findAllActiveOrderBySortOrder();
}
