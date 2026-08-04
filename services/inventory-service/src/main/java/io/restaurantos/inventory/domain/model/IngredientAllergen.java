package io.restaurantos.inventory.domain.model;

import io.restaurantos.shared.entity.TenantAuditableEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.Setter;

import java.util.UUID;

/** Maps to {@code ingredient_allergens} (V6 migration) — one row per declared allergen code. */
@Entity
@Table(name = "ingredient_allergens")
@Getter
@Setter
public class IngredientAllergen extends TenantAuditableEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(name = "ingredient_id", nullable = false)
    private UUID ingredientId;

    @Column(name = "allergen_code", nullable = false, length = 30)
    private String allergenCode;
}
