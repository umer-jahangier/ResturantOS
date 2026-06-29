package io.restaurantos.pos.repository;

import io.restaurantos.pos.domain.model.MenuItem;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.UUID;

@Repository
public interface MenuItemRepository extends JpaRepository<MenuItem, UUID> {

    @Query("SELECT i FROM MenuItem i WHERE i.category.id = :categoryId AND i.active = true ORDER BY i.name ASC")
    List<MenuItem> findByCategoryIdAndActiveTrue(@Param("categoryId") UUID categoryId);

    @Query("SELECT i FROM MenuItem i WHERE i.active = true ORDER BY i.name ASC")
    Page<MenuItem> findByActiveTrue(Pageable pageable);
}
