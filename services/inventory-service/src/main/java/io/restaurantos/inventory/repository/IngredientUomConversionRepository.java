package io.restaurantos.inventory.repository;

import io.restaurantos.inventory.domain.model.IngredientUomConversion;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;

import java.util.Collection;
import java.util.List;
import java.util.UUID;

@Repository
public interface IngredientUomConversionRepository extends JpaRepository<IngredientUomConversion, UUID> {

    List<IngredientUomConversion> findByTenantIdAndIngredientId(UUID tenantId, UUID ingredientId);

    /**
     * Conversion rows naming this unit on EITHER side — part of the unit-retire guard (36-05).
     * Both sides matter: retiring the "from" of a conversion breaks it exactly as thoroughly as
     * retiring the "to".
     */
    @Query("select count(c) from IngredientUomConversion c where c.tenantId = :tenantId "
            + "and (lower(c.fromUomCode) = lower(:code) or lower(c.toUomCode) = lower(:code))")
    long countByUomCodeEitherSide(@Param("tenantId") UUID tenantId, @Param("code") String code);

    /** Bulk fetch for list rendering — one query for the whole page, never one per ingredient. */
    List<IngredientUomConversion> findByTenantIdAndIngredientIdIn(UUID tenantId, Collection<UUID> ingredientIds);

    /**
     * A genuine bulk JPQL DELETE (not the entity-based load-then-remove a plain derived
     * {@code deleteBy...} method would generate). That matters here: Hibernate's flush-time
     * action-queue always orders INSERTs before DELETEs regardless of call order, so a deferred
     * per-entity remove() would let {@code IngredientService.replaceConversions}'s subsequent
     * {@code save()} of a same-key replacement row hit {@code uq_ingredient_conversion} before
     * the old row was actually gone. {@code flushAutomatically}/{@code clearAutomatically} make
     * this delete execute immediately, ahead of the following inserts.
     */
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Transactional
    @Query("DELETE FROM IngredientUomConversion c WHERE c.tenantId = :tenantId AND c.ingredientId = :ingredientId")
    void deleteByTenantIdAndIngredientId(@Param("tenantId") UUID tenantId, @Param("ingredientId") UUID ingredientId);
}
