package io.restaurantos.inventory.repository;

import io.restaurantos.inventory.domain.model.RecipeLine;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.UUID;

@Repository
public interface RecipeLineRepository extends JpaRepository<RecipeLine, UUID> {

    List<RecipeLine> findByRecipeId(UUID recipeId);
}
