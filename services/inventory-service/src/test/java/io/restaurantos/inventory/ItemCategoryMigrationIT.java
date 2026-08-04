package io.restaurantos.inventory;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.dao.DataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;

import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * Proves the V5__item_categories.sql (08.2-01) surface at the JDBC/migration level: the D-02
 * 3-level depth trigger, the RESTRICT-only ingredients.category_id foreign key, the NOT NULL
 * constraint on that column, and — the regression guard for the migration's own temporary
 * NO FORCE window — that ingredients is still FORCE ROW LEVEL SECURITY after V5 completes.
 *
 * The Testcontainers Postgres connection is a superuser, so RLS never blocks these raw
 * JdbcTemplate inserts; every assertion here is database-level behaviour (trigger exceptions,
 * pg_catalog / information_schema / pg_constraint metadata), matching SchemaMigrationIT's style.
 */
class ItemCategoryMigrationIT extends InventoryTestBase {

    @Autowired
    JdbcTemplate jdbcTemplate;

    private UUID insertCategory(UUID tenantId, UUID parentId, int level, String name) {
        UUID id = UUID.randomUUID();
        jdbcTemplate.update(
                "INSERT INTO item_categories (id, tenant_id, parent_id, level, name) VALUES (?, ?, ?, ?, ?)",
                id, tenantId, parentId, level, name);
        return id;
    }

    private UUID insertIngredient(UUID tenantId, UUID categoryId, String name) {
        UUID id = UUID.randomUUID();
        jdbcTemplate.update(
                "INSERT INTO ingredients (id, tenant_id, name, base_uom_code, reorder_point, category_id) "
                        + "VALUES (?, ?, ?, ?, ?, ?)",
                id, tenantId, name, "EACH", java.math.BigDecimal.ZERO, categoryId);
        return id;
    }

    @Test
    void depthTriggerAcceptsThreeLevelsAndRejectsAFourth() {
        UUID tenantId = UUID.randomUUID();

        UUID root = insertCategory(tenantId, null, 1, "Root " + UUID.randomUUID());
        UUID child = insertCategory(tenantId, root, 2, "Child " + UUID.randomUUID());
        UUID grandchild = insertCategory(tenantId, child, 3, "Grandchild " + UUID.randomUUID());

        assertThatThrownBy(() -> insertCategory(tenantId, grandchild, 4, "GreatGrandchild " + UUID.randomUUID()))
                .isInstanceOf(DataAccessException.class)
                .hasMessageContaining("maximum depth is 3 levels");
    }

    @Test
    void depthTriggerRejectsLevelMismatch() {
        UUID tenantId = UUID.randomUUID();

        UUID root = insertCategory(tenantId, null, 1, "Root " + UUID.randomUUID());

        assertThatThrownBy(() -> insertCategory(tenantId, root, 3, "SkipsLevel2 " + UUID.randomUUID()))
                .isInstanceOf(DataAccessException.class)
                .hasMessageContaining("must be exactly one greater than parent level");
    }

    @Test
    void depthTriggerRejectsCrossTenantParent() {
        UUID tenantA = UUID.randomUUID();
        UUID tenantB = UUID.randomUUID();

        UUID rootA = insertCategory(tenantA, null, 1, "Root " + UUID.randomUUID());

        assertThatThrownBy(() -> insertCategory(tenantB, rootA, 2, "CrossTenantChild " + UUID.randomUUID()))
                .isInstanceOf(DataAccessException.class)
                .hasMessageContaining("belongs to a different tenant");
    }

    @Test
    void ingredientCategoryIdIsNotNullAndRestrictsDeletes() {
        String isNullable = jdbcTemplate.queryForObject(
                "SELECT is_nullable FROM information_schema.columns "
                        + "WHERE table_name = 'ingredients' AND column_name = 'category_id'",
                String.class);
        assertThat(isNullable).isEqualTo("NO");

        String confdeltype = jdbcTemplate.queryForObject(
                "SELECT confdeltype::text FROM pg_constraint WHERE conname = 'fk_ingredient_category'",
                String.class);
        assertThat(confdeltype).isEqualTo("r");

        UUID tenantId = UUID.randomUUID();
        UUID categoryId = insertCategory(tenantId, null, 1, "Restrict Test " + UUID.randomUUID());
        insertIngredient(tenantId, categoryId, "Flour " + UUID.randomUUID());

        assertThatThrownBy(() -> jdbcTemplate.update("DELETE FROM item_categories WHERE id = ?", categoryId))
                .isInstanceOf(DataAccessException.class);
    }

    @Test
    void ingredientsStillForceRlsAfterBackfill() {
        var rlsFlags = jdbcTemplate.queryForMap(
                "SELECT relrowsecurity, relforcerowsecurity FROM pg_class "
                        + "WHERE relname = ? AND relnamespace = 'public'::regnamespace",
                "ingredients");

        assertThat(rlsFlags.get("relrowsecurity")).isEqualTo(true);
        assertThat(rlsFlags.get("relforcerowsecurity")).isEqualTo(true);
    }
}
