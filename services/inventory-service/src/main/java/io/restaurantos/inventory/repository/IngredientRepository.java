package io.restaurantos.inventory.repository;

import io.restaurantos.inventory.domain.model.Ingredient;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Repository
public interface IngredientRepository extends JpaRepository<Ingredient, UUID> {

    Optional<Ingredient> findBySku(String sku);

    List<Ingredient> findByActiveTrue();
}
