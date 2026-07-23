package io.restaurantos.inventory.service;

import io.restaurantos.inventory.domain.model.ItemCategory;
import io.restaurantos.inventory.dto.ItemCategoryDtos.CreateItemCategoryRequest;
import io.restaurantos.inventory.dto.ItemCategoryDtos.ItemCategoryDto;
import io.restaurantos.inventory.dto.ItemCategoryDtos.ItemCategoryNodeDto;
import io.restaurantos.inventory.dto.ItemCategoryDtos.MoveItemCategoryRequest;
import io.restaurantos.inventory.dto.ItemCategoryDtos.ResolvedGlAccountsDto;
import io.restaurantos.inventory.dto.ItemCategoryDtos.UpdateItemCategoryRequest;
import io.restaurantos.inventory.exception.CategoryInUseException;
import io.restaurantos.inventory.exception.CategoryValidationException;
import io.restaurantos.inventory.repository.IngredientRepository;
import io.restaurantos.inventory.repository.ItemCategoryRepository;
import io.restaurantos.shared.exception.ResourceNotFoundException;
import io.restaurantos.shared.tenant.TenantContext;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Deque;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;

/**
 * Category tree CRUD, re-parent (with cycle + depth validation), archive-with-refusal, and
 * most-specific-wins GL account resolution (INV-13). Tenant is always resolved from
 * {@link TenantContext} — a client can never supply its own tenant id (must_haves.prohibitions #2).
 * Depth/cycle checks here mirror {@code trg_item_category_depth} (V5 migration) so a caller gets a
 * readable error instead of a raw SQLSTATE — the trigger remains the actual enforcement point.
 */
@Service
@Transactional(readOnly = true)
public class ItemCategoryService {

    private static final short MAX_LEVEL = 3;

    private final ItemCategoryRepository itemCategoryRepository;
    private final IngredientRepository ingredientRepository;
    private final TenantContext tenantContext;

    public ItemCategoryService(ItemCategoryRepository itemCategoryRepository,
                                IngredientRepository ingredientRepository,
                                TenantContext tenantContext) {
        this.itemCategoryRepository = itemCategoryRepository;
        this.ingredientRepository = ingredientRepository;
        this.tenantContext = tenantContext;
    }

    public List<ItemCategoryDto> listCategories(boolean includeArchived) {
        UUID tenantId = tenantContext.requireTenantId();
        List<ItemCategory> all = itemCategoryRepository.findByTenantIdOrderBySortOrderAscNameAsc(tenantId);
        Map<UUID, ItemCategory> byId = indexById(all);
        Map<UUID, Long> ingredientCounts = ingredientCountsByCategory(tenantId);
        return all.stream()
                .filter(c -> includeArchived || c.getArchivedAt() == null)
                .map(c -> toDto(c, byId, ingredientCounts))
                .toList();
    }

    public List<ItemCategoryNodeDto> getTree(boolean includeArchived) {
        UUID tenantId = tenantContext.requireTenantId();
        List<ItemCategory> all = itemCategoryRepository.findByTenantIdOrderBySortOrderAscNameAsc(tenantId);
        Map<UUID, ItemCategory> byId = indexById(all);
        Map<UUID, Long> ingredientCounts = ingredientCountsByCategory(tenantId);

        Map<UUID, List<ItemCategory>> byParent = new HashMap<>();
        for (ItemCategory c : all) {
            if (!includeArchived && c.getArchivedAt() != null) {
                continue;
            }
            byParent.computeIfAbsent(c.getParentId(), k -> new ArrayList<>()).add(c);
        }

        List<ItemCategory> roots = byParent.getOrDefault(null, List.of());
        return roots.stream().map(root -> buildNode(root, byParent, byId, ingredientCounts)).toList();
    }

    public ItemCategoryDto getCategory(UUID id) {
        UUID tenantId = tenantContext.requireTenantId();
        ItemCategory category = requireCategory(tenantId, id);
        Map<UUID, ItemCategory> byId = allById(tenantId);
        Map<UUID, Long> ingredientCounts = ingredientCountsByCategory(tenantId);
        return toDto(category, byId, ingredientCounts);
    }

    @Transactional
    public ItemCategoryDto create(CreateItemCategoryRequest request) {
        UUID tenantId = tenantContext.requireTenantId();
        ItemCategory entity = new ItemCategory();
        entity.setTenantId(tenantId);
        applyCommonFields(entity, request.name(), request.code(), request.defaultInventoryAccountCode(),
                request.defaultCostAccountCode(), request.defaultWasteAccountCode(), request.varianceCapPct(),
                request.excludeFromPoSuggestions(), request.sortOrder());

        if (request.parentId() == null) {
            entity.setParentId(null);
            entity.setLevel((short) 1);
        } else {
            ItemCategory parent = requireCategory(tenantId, request.parentId());
            if (parent.getLevel() >= MAX_LEVEL) {
                throw new CategoryValidationException("Categories are limited to 3 levels deep; \""
                        + parent.getName() + "\" is already at the maximum depth.");
            }
            entity.setParentId(parent.getId());
            entity.setLevel((short) (parent.getLevel() + 1));
        }

        ItemCategory saved = itemCategoryRepository.save(entity);
        Map<UUID, ItemCategory> byId = allById(tenantId);
        return toDto(saved, byId, ingredientCountsByCategory(tenantId));
    }

    @Transactional
    public ItemCategoryDto update(UUID id, UpdateItemCategoryRequest request) {
        UUID tenantId = tenantContext.requireTenantId();
        ItemCategory entity = requireCategory(tenantId, id);
        applyCommonFields(entity, request.name(), request.code(), request.defaultInventoryAccountCode(),
                request.defaultCostAccountCode(), request.defaultWasteAccountCode(), request.varianceCapPct(),
                request.excludeFromPoSuggestions(), request.sortOrder());
        // parentId/level are never touched here — re-parenting is exclusively move()'s job.
        ItemCategory saved = itemCategoryRepository.save(entity);
        Map<UUID, ItemCategory> byId = allById(tenantId);
        return toDto(saved, byId, ingredientCountsByCategory(tenantId));
    }

    @Transactional
    public ItemCategoryDto move(UUID id, MoveItemCategoryRequest request) {
        UUID tenantId = tenantContext.requireTenantId();
        ItemCategory node = requireCategory(tenantId, id);
        Map<UUID, ItemCategory> byId = allById(tenantId);
        Map<UUID, List<ItemCategory>> byParent = groupByParent(byId.values());

        UUID newParentId = request.newParentId();
        short newLevel;
        if (newParentId == null) {
            newLevel = 1;
        } else {
            if (newParentId.equals(id)) {
                throw new CategoryValidationException("A category cannot be its own parent.");
            }
            Set<UUID> descendantIds = collectDescendantIds(id, byParent);
            if (descendantIds.contains(newParentId)) {
                throw new CategoryValidationException(
                        "A category cannot be moved under one of its own descendants.");
            }
            ItemCategory newParent = byId.get(newParentId);
            if (newParent == null) {
                throw new ResourceNotFoundException("ItemCategory", newParentId);
            }
            if (newParent.getLevel() >= MAX_LEVEL) {
                throw new CategoryValidationException("Categories are limited to 3 levels deep; \""
                        + newParent.getName() + "\" is already at the maximum depth.");
            }
            newLevel = (short) (newParent.getLevel() + 1);
        }

        int subtreeDepth = subtreeDepth(id, byParent);
        if (newLevel + subtreeDepth > MAX_LEVEL) {
            throw new CategoryValidationException(
                    "Moving this category would push one of its subcategories past the 3-level limit.");
        }

        node.setParentId(newParentId);
        node.setLevel(newLevel);
        itemCategoryRepository.save(node);
        updateDescendantLevels(id, newLevel, byParent);

        Map<UUID, ItemCategory> refreshed = allById(tenantId);
        return toDto(refreshed.get(id), refreshed, ingredientCountsByCategory(tenantId));
    }

    @Transactional
    public void archive(UUID id) {
        UUID tenantId = tenantContext.requireTenantId();
        ItemCategory category = requireCategory(tenantId, id);
        long ingredientCount = ingredientRepository.countByTenantIdAndCategoryIdAndArchivedAtIsNull(tenantId, id);
        long childCount = itemCategoryRepository.countByTenantIdAndParentIdAndArchivedAtIsNull(tenantId, id);
        if (ingredientCount > 0 || childCount > 0) {
            throw new CategoryInUseException(id, ingredientCount, childCount);
        }
        category.setArchivedAt(Instant.now());
        itemCategoryRepository.save(category);
    }

    @Transactional
    public void restore(UUID id) {
        UUID tenantId = tenantContext.requireTenantId();
        ItemCategory category = requireCategory(tenantId, id);
        if (category.getParentId() != null) {
            ItemCategory parent = requireCategory(tenantId, category.getParentId());
            if (parent.getArchivedAt() != null) {
                throw new CategoryValidationException("Cannot restore — its parent category \""
                        + parent.getName() + "\" is archived. Restore the parent first.");
            }
        }
        category.setArchivedAt(null);
        itemCategoryRepository.save(category);
    }

    // ---- helpers ----

    private void applyCommonFields(ItemCategory entity, String name, String code,
                                    String defaultInventoryAccountCode, String defaultCostAccountCode,
                                    String defaultWasteAccountCode, java.math.BigDecimal varianceCapPct,
                                    Boolean excludeFromPoSuggestions, Integer sortOrder) {
        entity.setName(name);
        entity.setCode(code);
        entity.setDefaultInventoryAccountCode(defaultInventoryAccountCode);
        entity.setDefaultCostAccountCode(defaultCostAccountCode);
        entity.setDefaultWasteAccountCode(defaultWasteAccountCode);
        entity.setVarianceCapPct(varianceCapPct);
        entity.setExcludeFromPoSuggestions(Boolean.TRUE.equals(excludeFromPoSuggestions));
        entity.setSortOrder(sortOrder != null ? sortOrder : entity.getSortOrder());
    }

    private ItemCategory requireCategory(UUID tenantId, UUID id) {
        return itemCategoryRepository.findByTenantIdAndId(tenantId, id)
                .orElseThrow(() -> new ResourceNotFoundException("ItemCategory", id));
    }

    private Map<UUID, ItemCategory> allById(UUID tenantId) {
        return indexById(itemCategoryRepository.findByTenantIdOrderBySortOrderAscNameAsc(tenantId));
    }

    private Map<UUID, ItemCategory> indexById(List<ItemCategory> all) {
        return all.stream().collect(Collectors.toMap(ItemCategory::getId, c -> c));
    }

    private Map<UUID, List<ItemCategory>> groupByParent(Collection<ItemCategory> all) {
        Map<UUID, List<ItemCategory>> byParent = new HashMap<>();
        for (ItemCategory c : all) {
            byParent.computeIfAbsent(c.getParentId(), k -> new ArrayList<>()).add(c);
        }
        return byParent;
    }

    private ItemCategoryNodeDto buildNode(ItemCategory node, Map<UUID, List<ItemCategory>> byParent,
                                           Map<UUID, ItemCategory> byId, Map<UUID, Long> ingredientCounts) {
        List<ItemCategoryNodeDto> children = byParent.getOrDefault(node.getId(), List.of()).stream()
                .map(child -> buildNode(child, byParent, byId, ingredientCounts))
                .toList();
        return new ItemCategoryNodeDto(toDto(node, byId, ingredientCounts), children);
    }

    private Set<UUID> collectDescendantIds(UUID nodeId, Map<UUID, List<ItemCategory>> byParent) {
        Set<UUID> result = new HashSet<>();
        Deque<UUID> queue = new ArrayDeque<>();
        queue.add(nodeId);
        while (!queue.isEmpty()) {
            UUID current = queue.poll();
            for (ItemCategory child : byParent.getOrDefault(current, List.of())) {
                if (result.add(child.getId())) {
                    queue.add(child.getId());
                }
            }
        }
        return result;
    }

    /** 0 for a leaf, otherwise the number of levels below {@code nodeId} in its own subtree. */
    private int subtreeDepth(UUID nodeId, Map<UUID, List<ItemCategory>> byParent) {
        int maxChildDepth = 0;
        for (ItemCategory child : byParent.getOrDefault(nodeId, List.of())) {
            maxChildDepth = Math.max(maxChildDepth, 1 + subtreeDepth(child.getId(), byParent));
        }
        return maxChildDepth;
    }

    private void updateDescendantLevels(UUID nodeId, short parentLevel, Map<UUID, List<ItemCategory>> byParent) {
        for (ItemCategory child : byParent.getOrDefault(nodeId, List.of())) {
            short childLevel = (short) (parentLevel + 1);
            child.setLevel(childLevel);
            itemCategoryRepository.save(child);
            updateDescendantLevels(child.getId(), childLevel, byParent);
        }
    }

    private Map<UUID, Long> ingredientCountsByCategory(UUID tenantId) {
        Map<UUID, Long> counts = new HashMap<>();
        for (Object[] row : ingredientRepository.countByTenantIdGroupedByCategory(tenantId)) {
            UUID categoryId = (UUID) row[0];
            Long count = (Long) row[1];
            if (categoryId != null) {
                counts.put(categoryId, count);
            }
        }
        return counts;
    }

    private ResolvedGlAccountsDto resolveGlAccounts(ItemCategory node, Map<UUID, ItemCategory> byId) {
        ResolvedAccount inventoryAccount = resolveAccount(node, byId, ItemCategory::getDefaultInventoryAccountCode);
        ResolvedAccount costAccount = resolveAccount(node, byId, ItemCategory::getDefaultCostAccountCode);
        ResolvedAccount wasteAccount = resolveAccount(node, byId, ItemCategory::getDefaultWasteAccountCode);
        return new ResolvedGlAccountsDto(
                inventoryAccount.code(), costAccount.code(), wasteAccount.code(),
                inventoryAccount.inherited(), costAccount.inherited(), wasteAccount.inherited());
    }

    /**
     * Walks {@code node} then {@code parentId} upward, returning the first non-blank account
     * code — most-specific-wins. {@code inherited} is true whenever the winning code did not
     * come from {@code node} itself.
     */
    private ResolvedAccount resolveAccount(ItemCategory node, Map<UUID, ItemCategory> byId,
                                            Function<ItemCategory, String> accessor) {
        String own = accessor.apply(node);
        if (own != null && !own.isBlank()) {
            return new ResolvedAccount(own, false);
        }
        UUID parentId = node.getParentId();
        while (parentId != null) {
            ItemCategory ancestor = byId.get(parentId);
            if (ancestor == null) {
                break;
            }
            String ancestorCode = accessor.apply(ancestor);
            if (ancestorCode != null && !ancestorCode.isBlank()) {
                return new ResolvedAccount(ancestorCode, true);
            }
            parentId = ancestor.getParentId();
        }
        return new ResolvedAccount(null, false);
    }

    private record ResolvedAccount(String code, boolean inherited) {}

    private ItemCategoryDto toDto(ItemCategory c, Map<UUID, ItemCategory> byId, Map<UUID, Long> ingredientCounts) {
        return new ItemCategoryDto(
                c.getId(),
                c.getParentId(),
                c.getLevel(),
                c.getCode(),
                c.getName(),
                c.getDefaultInventoryAccountCode(),
                c.getDefaultCostAccountCode(),
                c.getDefaultWasteAccountCode(),
                c.getVarianceCapPct(),
                c.isExcludeFromPoSuggestions(),
                c.getSortOrder(),
                c.getArchivedAt(),
                ingredientCounts.getOrDefault(c.getId(), 0L),
                resolveGlAccounts(c, byId));
    }
}
