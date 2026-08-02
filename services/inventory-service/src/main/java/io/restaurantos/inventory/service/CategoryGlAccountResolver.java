package io.restaurantos.inventory.service;

import io.restaurantos.inventory.domain.model.Ingredient;
import io.restaurantos.inventory.domain.model.ItemCategory;
import io.restaurantos.inventory.feign.GlAccountDto;
import io.restaurantos.inventory.repository.IngredientRepository;
import io.restaurantos.inventory.repository.ItemCategoryRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.Collection;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/**
 * Resolves the GL account CODES an ingredient's category names, so a depletion or write-off event
 * can carry them and finance never has to learn the inventory taxonomy.
 *
 * <p>Phase 08.2 gave {@code ItemCategory} three account slots — inventory, cost, waste — with a
 * validating finance proxy and a management screen, and nothing ever read them. Every COGS entry
 * went to one tenant-wide {@code COGS} tag, so a restaurant that had carefully mapped Beverages to
 * 5200 and Packaging to 5210 saw all of it land in 5100 Food Cost.
 *
 * <p><b>Inheritance.</b> An account set on a parent category applies to its children unless a child
 * overrides it — the 3-level tree exists precisely so "Meat" and "Seafood" can both inherit
 * "Perishables"' cost account. The walk stops at the first non-null ancestor.
 *
 * <p><b>Fail-soft by design.</b> Anything unresolvable — no category, no mapping anywhere up the
 * tree, an archived account, finance unreachable — yields {@code null}, and the consumer falls back
 * to the tenant-wide tag. A missing cost-centre mapping must never stop a sale from posting.
 */
@Service
public class CategoryGlAccountResolver {

    private static final Logger log = LoggerFactory.getLogger(CategoryGlAccountResolver.class);

    private final IngredientRepository ingredientRepository;
    private final ItemCategoryRepository categoryRepository;
    private final GlAccountLookupService glAccountLookupService;

    public CategoryGlAccountResolver(IngredientRepository ingredientRepository,
                                     ItemCategoryRepository categoryRepository,
                                     GlAccountLookupService glAccountLookupService) {
        this.ingredientRepository = ingredientRepository;
        this.categoryRepository = categoryRepository;
        this.glAccountLookupService = glAccountLookupService;
    }

    /** The cost and inventory account codes for each ingredient, keyed by ingredientId. */
    @Transactional(readOnly = true)
    public Map<UUID, Accounts> resolveFor(UUID tenantId, Collection<UUID> ingredientIds) {
        if (ingredientIds == null || ingredientIds.isEmpty()) {
            return Map.of();
        }
        try {
            List<ItemCategory> categories = categoryRepository.findByTenantIdOrderBySortOrderAscNameAsc(tenantId);
            Map<UUID, ItemCategory> byId = new HashMap<>();
            categories.forEach(c -> byId.put(c.getId(), c));

            Map<UUID, UUID> costAccountIdByIngredient = new HashMap<>();
            Map<UUID, UUID> inventoryAccountIdByIngredient = new HashMap<>();
            Set<UUID> accountIds = new LinkedHashSet<>();

            for (Ingredient ingredient : ingredientRepository.findAllById(ingredientIds)) {
                UUID cost = inherited(byId, ingredient.getCategoryId(), ItemCategory::getDefaultCostAccountId);
                UUID inventory = inherited(byId, ingredient.getCategoryId(), ItemCategory::getDefaultInventoryAccountId);
                if (cost != null) {
                    costAccountIdByIngredient.put(ingredient.getId(), cost);
                    accountIds.add(cost);
                }
                if (inventory != null) {
                    inventoryAccountIdByIngredient.put(ingredient.getId(), inventory);
                    accountIds.add(inventory);
                }
            }

            if (accountIds.isEmpty()) {
                return Map.of();
            }

            Map<UUID, GlAccountDto> accounts = glAccountLookupService.resolveByIds(accountIds);
            Map<UUID, Accounts> result = new HashMap<>();
            for (UUID ingredientId : ingredientIds) {
                String costCode = codeOf(accounts, costAccountIdByIngredient.get(ingredientId));
                String inventoryCode = codeOf(accounts, inventoryAccountIdByIngredient.get(ingredientId));
                if (costCode != null || inventoryCode != null) {
                    result.put(ingredientId, new Accounts(costCode, inventoryCode));
                }
            }
            return result;
        } catch (Exception e) {
            // Never block a sale from posting because a cost-centre mapping could not be read.
            log.warn("Category GL account resolution failed; falling back to tenant-wide tags: {}",
                    e.getMessage());
            return Map.of();
        }
    }

    /** Nearest non-null value walking up the category tree, with a cycle guard. */
    private static UUID inherited(Map<UUID, ItemCategory> byId, UUID startId,
                                  java.util.function.Function<ItemCategory, UUID> pick) {
        Set<UUID> seen = new HashSet<>();
        UUID currentId = startId;
        while (currentId != null && seen.add(currentId)) {
            ItemCategory category = byId.get(currentId);
            if (category == null) {
                return null;
            }
            UUID value = pick.apply(category);
            if (value != null) {
                return value;
            }
            currentId = category.getParentId();
        }
        return null;
    }

    private static String codeOf(Map<UUID, GlAccountDto> accounts, UUID accountId) {
        if (accountId == null) {
            return null;
        }
        GlAccountDto account = accounts.get(accountId);
        // An inactive account is treated as unmapped: posting to a deactivated account would fail
        // downstream, and the tenant-wide fallback is always valid.
        return account != null && account.active() ? account.code() : null;
    }

    /** Either code may be null — the consumer falls back to its tenant-wide tag. */
    public record Accounts(String cogsAccountCode, String inventoryAccountCode) {}
}
