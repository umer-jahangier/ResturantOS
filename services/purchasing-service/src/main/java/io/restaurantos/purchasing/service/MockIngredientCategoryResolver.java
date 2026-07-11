package io.restaurantos.purchasing.service;

import org.springframework.core.io.ClassPathResource;
import org.springframework.stereotype.Service;
import org.yaml.snakeyaml.Yaml;

import java.io.IOException;
import java.io.InputStream;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

/**
 * Mock-first {@link IngredientCategoryResolver}: loads {@code spend-category-map.yml} from the classpath
 * (ingredient UUID -> category name) with no inventory-service dependency. Unmapped ingredient ids resolve
 * to "Uncategorized" rather than failing, since PUR-06 must work on partial mock fixtures.
 *
 * <p>Phase 8 will add a feign-backed resolver keyed on {@code restaurantos.inventory.integration-mode},
 * the same mock/feign seam {@code GrnDataPort} already uses for GRN data.
 */
@Service
public class MockIngredientCategoryResolver implements IngredientCategoryResolver {

    private static final String UNCATEGORIZED = "Uncategorized";

    private final Map<UUID, String> categoryByIngredientId;

    public MockIngredientCategoryResolver() {
        this.categoryByIngredientId = loadMap();
    }

    @Override
    public String resolve(UUID ingredientId) {
        if (ingredientId == null) {
            return UNCATEGORIZED;
        }
        return categoryByIngredientId.getOrDefault(ingredientId, UNCATEGORIZED);
    }

    @SuppressWarnings("unchecked")
    private static Map<UUID, String> loadMap() {
        Map<UUID, String> result = new HashMap<>();
        try (InputStream in = new ClassPathResource("spend-category-map.yml").getInputStream()) {
            Yaml yaml = new Yaml();
            Map<String, Object> root = yaml.load(in);
            if (root == null) {
                return result;
            }
            Object categoriesRaw = root.get("categories");
            if (!(categoriesRaw instanceof Map)) {
                return result;
            }
            Map<String, String> categories = (Map<String, String>) categoriesRaw;
            for (Map.Entry<String, String> entry : categories.entrySet()) {
                try {
                    result.put(UUID.fromString(entry.getKey()), entry.getValue());
                } catch (IllegalArgumentException ignored) {
                    // skip malformed keys rather than fail startup on a mock fixture typo
                }
            }
            return result;
        } catch (IOException e) {
            throw new IllegalStateException("Failed to load spend-category-map.yml", e);
        }
    }
}
