package io.restaurantos.inventory.service;

import io.restaurantos.inventory.domain.model.ItemCategory;
import io.restaurantos.inventory.dto.ItemCategoryDtos.CreateItemCategoryRequest;
import io.restaurantos.inventory.dto.ItemCategoryDtos.ItemCategoryDto;
import io.restaurantos.inventory.dto.ItemCategoryDtos.ItemCategoryNodeDto;
import io.restaurantos.inventory.dto.ItemCategoryDtos.MoveItemCategoryRequest;
import io.restaurantos.inventory.dto.ItemCategoryDtos.ResolvedGlAccountsDto;
import io.restaurantos.inventory.dto.ItemCategoryDtos.UpdateItemCategoryRequest;
import io.restaurantos.inventory.exception.CategoryInUseException;
import io.restaurantos.inventory.exception.CategoryNameDuplicateException;
import io.restaurantos.inventory.exception.CategoryValidationException;
import io.restaurantos.inventory.exception.GlAccountInvalidException;
import io.restaurantos.inventory.feign.GlAccountDto;
import io.restaurantos.inventory.repository.IngredientRepository;
import io.restaurantos.inventory.repository.ItemCategoryRepository;
import io.restaurantos.shared.exception.ResourceNotFoundException;
import io.restaurantos.shared.tenant.TenantContext;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
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
import java.util.stream.Stream;

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

    private static final Logger log = LoggerFactory.getLogger(ItemCategoryService.class);
    private static final short MAX_LEVEL = 3;

    private final ItemCategoryRepository itemCategoryRepository;
    private final IngredientRepository ingredientRepository;
    private final GlAccountLookupService glAccountLookupService;
    private final TenantContext tenantContext;

    public ItemCategoryService(ItemCategoryRepository itemCategoryRepository,
                                IngredientRepository ingredientRepository,
                                GlAccountLookupService glAccountLookupService,
                                TenantContext tenantContext) {
        this.itemCategoryRepository = itemCategoryRepository;
        this.ingredientRepository = ingredientRepository;
        this.glAccountLookupService = glAccountLookupService;
        this.tenantContext = tenantContext;
    }

    public List<ItemCategoryDto> listCategories(boolean includeArchived) {
        UUID tenantId = tenantContext.requireTenantId();
        List<ItemCategory> all = itemCategoryRepository.findByTenantIdOrderBySortOrderAscNameAsc(tenantId);
        Map<UUID, ItemCategory> byId = indexById(all);
        Map<UUID, Long> ingredientCounts = ingredientCountsByCategory(tenantId);
        Map<String, String> accountNames = glAccountNames(all);
        return all.stream()
                .filter(c -> includeArchived || c.getArchivedAt() == null)
                .map(c -> toDto(c, byId, ingredientCounts, accountNames))
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
        Map<String, String> accountNames = glAccountNames(all);
        return roots.stream()
                .map(root -> buildNode(root, byParent, byId, ingredientCounts, accountNames))
                .toList();
    }

    public ItemCategoryDto getCategory(UUID id) {
        UUID tenantId = tenantContext.requireTenantId();
        ItemCategory category = requireCategory(tenantId, id);
        Map<UUID, ItemCategory> byId = allById(tenantId);
        Map<UUID, Long> ingredientCounts = ingredientCountsByCategory(tenantId);
        return toDto(category, byId, ingredientCounts, glAccountNames(byId.values()));
    }

    @Transactional
    public ItemCategoryDto create(CreateItemCategoryRequest request) {
        UUID tenantId = tenantContext.requireTenantId();
        ItemCategory entity = new ItemCategory();
        entity.setTenantId(tenantId);
        applyCommonFields(entity, request.name(), request.code(), request.defaultInventoryAccountCode(),
                request.defaultCostAccountCode(), request.defaultWasteAccountCode(), request.varianceCapPct(),
                request.excludeFromPoSuggestions(), request.sortOrder());

        String parentName = null;
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
            parentName = parent.getName();
        }
        requireNameNotTaken(tenantId, entity.getParentId(), entity.getName(), parentName, null);

        ItemCategory saved = itemCategoryRepository.save(entity);
        Map<UUID, ItemCategory> byId = allById(tenantId);
        return toDto(saved, byId, ingredientCountsByCategory(tenantId), glAccountNames(byId.values()));
    }

    @Transactional
    public ItemCategoryDto update(UUID id, UpdateItemCategoryRequest request) {
        UUID tenantId = tenantContext.requireTenantId();
        ItemCategory entity = requireCategory(tenantId, id);
        // The duplicate-name check runs BEFORE entity is mutated, and deliberately checks
        // request.name() rather than entity.getName() post-mutation. Hibernate auto-flushes
        // pending dirty state ahead of a native query it cannot prove is unaffected by it — so
        // renaming the managed entity first and checking second let the flush write the collision
        // straight into the unique constraint, throwing the raw DataIntegrityViolationException
        // before requireNameNotTaken ever got to run. entity is still clean here, so there is
        // nothing for the flush to write.
        String parentName = entity.getParentId() == null ? null
                : requireCategory(tenantId, entity.getParentId()).getName();
        requireNameNotTaken(tenantId, entity.getParentId(), request.name(), parentName, entity.getId());
        applyCommonFields(entity, request.name(), request.code(), request.defaultInventoryAccountCode(),
                request.defaultCostAccountCode(), request.defaultWasteAccountCode(), request.varianceCapPct(),
                request.excludeFromPoSuggestions(), request.sortOrder());
        // parentId/level are never touched here — re-parenting is exclusively move()'s job.
        ItemCategory saved = itemCategoryRepository.save(entity);
        Map<UUID, ItemCategory> byId = allById(tenantId);
        return toDto(saved, byId, ingredientCountsByCategory(tenantId), glAccountNames(byId.values()));
    }

    /**
     * Pre-check for {@code uq_item_category_tenant_parent_name}, shared by every write path that
     * can trip it ({@link #create}, {@link #update}, {@link #move} — a rename or a re-parent both
     * reach the same constraint, not just a create). Without this the collision surfaces as a bare
     * {@code DataIntegrityViolationException}, which {@code GlobalExceptionHandler} can only answer
     * with an unhelpful 500 — and which the gateway's {@code CircuitBreaker} filter then rewrites
     * into a generic "service temporarily unavailable" for every route it fronts, discarding
     * whatever specific thing actually went wrong.
     */
    private void requireNameNotTaken(UUID tenantId, UUID parentId, String name, String parentName, UUID excludeId) {
        itemCategoryRepository.findSibling(tenantId, parentId, name, excludeId).ifPresent(conflict -> {
            throw new CategoryNameDuplicateException(name, parentName, conflict.getArchivedAt() != null);
        });
    }

    @Transactional
    public ItemCategoryDto move(UUID id, MoveItemCategoryRequest request) {
        UUID tenantId = tenantContext.requireTenantId();
        ItemCategory node = requireCategory(tenantId, id);
        Map<UUID, ItemCategory> byId = allById(tenantId);
        Map<UUID, List<ItemCategory>> byParent = groupByParent(byId.values());

        UUID newParentId = request.newParentId();
        short newLevel;
        String newParentName = null;
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
            newParentName = newParent.getName();
        }
        // A re-parent changes which sibling set the name is compared against — moving "Produce"
        // under a parent that already has a "Produce" is the same collision create()/update() guard
        // against, just reached by a different door.
        requireNameNotTaken(tenantId, newParentId, node.getName(), newParentName, id);

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
        return toDto(refreshed.get(id), refreshed, ingredientCountsByCategory(tenantId),
                glAccountNames(refreshed.values()));
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

    /**
     * Every category's resolved defaults, keyed by category id — one whole-tenant fetch, walked
     * once, for callers that need to look categories up per row.
     *
     * <p>{@code varianceCapPct} inherits most-specific-wins up the tree, exactly like the GL
     * accounts beside it: a cap set on "Proteins" applies to "Poultry" and "Chicken" underneath it
     * unless one of them sets its own. That is the point of putting the cap on a tree in the first
     * place — bulk flour tolerates measurement drift that saffron does not, and nobody wants to set
     * a threshold on every leaf.
     *
     * <p>Read by {@code StockCountService} (to decide whether a count line needs an override) and
     * {@code StockLevelService} (so the count sheet can warn BEFORE the post is rejected). Both get
     * the same numbers from the same walk, so the warning and the enforcement cannot disagree.
     */
    public Map<UUID, CategoryDefaults> resolveDefaultsByCategory(UUID tenantId) {
        Map<UUID, ItemCategory> byId = allById(tenantId);
        Map<UUID, CategoryDefaults> resolved = new HashMap<>(byId.size());
        for (ItemCategory category : byId.values()) {
            resolved.put(category.getId(), new CategoryDefaults(
                    category.getId(), category.getName(), resolveVarianceCap(category, byId),
                    resolveExcludedFromPoSuggestions(category, byId)));
        }
        return resolved;
    }

    /** Null when neither the category nor any ancestor sets a cap — i.e. variance is unlimited. */
    private static java.math.BigDecimal resolveVarianceCap(ItemCategory node, Map<UUID, ItemCategory> byId) {
        ItemCategory current = node;
        while (current != null) {
            if (current.getVarianceCapPct() != null) {
                return current.getVarianceCapPct();
            }
            current = current.getParentId() == null ? null : byId.get(current.getParentId());
        }
        return null;
    }

    /**
     * Excluded if the category OR ANY ancestor is flagged — deliberately NOT the most-specific-wins
     * rule the GL accounts and the variance cap use.
     *
     * <p>Those two answer "which value applies here?", so the nearest answer wins. This one is an
     * opt-out: turning suggestions off for "Beverages" is a statement about everything underneath
     * it, and a child silently re-enabling itself would defeat the point of saying it at the top.
     * Re-enabling a subtree means clearing the ancestor's flag, which is visible where it was set.
     */
    private static boolean resolveExcludedFromPoSuggestions(ItemCategory node, Map<UUID, ItemCategory> byId) {
        ItemCategory current = node;
        while (current != null) {
            if (current.isExcludeFromPoSuggestions()) {
                return true;
            }
            current = current.getParentId() == null ? null : byId.get(current.getParentId());
        }
        return false;
    }

    /** A category's inherited defaults, resolved once for the whole tenant. */
    public record CategoryDefaults(UUID categoryId, String categoryName,
                                    java.math.BigDecimal varianceCapPct,
                                    boolean excludedFromPoSuggestions) {}

    // ---- helpers ----

    private void applyCommonFields(ItemCategory entity, String name, String code,
                                    String defaultInventoryAccountCode, String defaultCostAccountCode,
                                    String defaultWasteAccountCode, java.math.BigDecimal varianceCapPct,
                                    Boolean excludeFromPoSuggestions, Integer sortOrder) {
        entity.setName(name);
        entity.setCode(code);
        applyGlAccounts(entity, defaultInventoryAccountCode, defaultCostAccountCode, defaultWasteAccountCode);
        entity.setVarianceCapPct(varianceCapPct);
        entity.setExcludeFromPoSuggestions(Boolean.TRUE.equals(excludeFromPoSuggestions));
        entity.setSortOrder(sortOrder != null ? sortOrder : entity.getSortOrder());
    }

    /**
     * Resolves each supplied account code against finance-service and persists the resulting
     * account's ID plus its own code, rather than whatever string arrived.
     *
     * <p>All three codes resolve in ONE call, so a category save costs at most one cross-service
     * round trip regardless of how many accounts it names. Clearing a field (blank/null) is always
     * allowed and needs no lookup — it simply means "inherit from the parent category".
     *
     * <p>Fails CLOSED: if finance-service cannot be reached,
     * {@link io.restaurantos.inventory.exception.FinanceUnavailableException} propagates as a 503
     * and nothing is written. Accepting an unverified code during an outage is exactly the silent
     * bad data this validation exists to stop.
     */
    private void applyGlAccounts(ItemCategory entity, String inventoryCode, String costCode, String wasteCode) {
        List<String> requested = Stream.of(inventoryCode, costCode, wasteCode)
                .filter(ItemCategoryService::hasText)
                .map(String::trim)
                .toList();

        Map<String, GlAccountDto> resolved = requested.isEmpty()
                ? Map.of()
                : glAccountLookupService.resolveByCodes(requested);

        GlAccountDto inventory = requireAccount(GlAccountUsage.INVENTORY, inventoryCode, resolved);
        GlAccountDto cost = requireAccount(GlAccountUsage.COST, costCode, resolved);
        GlAccountDto waste = requireAccount(GlAccountUsage.WASTE, wasteCode, resolved);

        entity.setDefaultInventoryAccountCode(inventory == null ? null : inventory.code());
        entity.setDefaultInventoryAccountId(inventory == null ? null : inventory.id());
        entity.setDefaultCostAccountCode(cost == null ? null : cost.code());
        entity.setDefaultCostAccountId(cost == null ? null : cost.id());
        entity.setDefaultWasteAccountCode(waste == null ? null : waste.code());
        entity.setDefaultWasteAccountId(waste == null ? null : waste.id());
    }

    /** Null for "not set" (inherit); otherwise a real, active account of a type this slot accepts. */
    private static GlAccountDto requireAccount(GlAccountUsage usage, String code,
                                                Map<String, GlAccountDto> resolved) {
        if (!hasText(code)) {
            return null;
        }
        GlAccountDto account = resolved.get(code.trim());
        if (account == null) {
            throw GlAccountInvalidException.notFound(usage, code.trim());
        }
        if (!account.active()) {
            throw GlAccountInvalidException.inactive(usage, account);
        }
        if (!usage.accepts(account.accountType())) {
            throw GlAccountInvalidException.wrongType(usage, account);
        }
        return account;
    }

    private static boolean hasText(String value) {
        return value != null && !value.isBlank();
    }

    /**
     * Best-effort {@code code → name} lookup so the tree and form can render "1400 · Food
     * Inventory" instead of a bare number.
     *
     * <p>Deliberately swallows a finance-service outage, unlike the write path: a manager should
     * still be able to browse and reorganise their categories when accounting is down. They just
     * see codes without names until it returns.
     */
    private Map<String, String> glAccountNames(Collection<ItemCategory> categories) {
        Set<String> codes = new HashSet<>();
        for (ItemCategory category : categories) {
            addIfPresent(codes, category.getDefaultInventoryAccountCode());
            addIfPresent(codes, category.getDefaultCostAccountCode());
            addIfPresent(codes, category.getDefaultWasteAccountCode());
        }
        if (codes.isEmpty()) {
            return Map.of();
        }
        try {
            Map<String, String> names = new HashMap<>();
            glAccountLookupService.resolveByCodes(codes)
                    .forEach((code, account) -> names.put(code, account.name()));
            return names;
        } catch (RuntimeException ex) {
            log.debug("Could not resolve GL account names for display; showing codes only", ex);
            return Map.of();
        }
    }

    private static void addIfPresent(Set<String> codes, String code) {
        if (hasText(code)) {
            codes.add(code.trim());
        }
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
                                           Map<UUID, ItemCategory> byId, Map<UUID, Long> ingredientCounts,
                                           Map<String, String> accountNames) {
        List<ItemCategoryNodeDto> children = byParent.getOrDefault(node.getId(), List.of()).stream()
                .map(child -> buildNode(child, byParent, byId, ingredientCounts, accountNames))
                .toList();
        return new ItemCategoryNodeDto(toDto(node, byId, ingredientCounts, accountNames), children);
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

    private ResolvedGlAccountsDto resolveGlAccounts(ItemCategory node, Map<UUID, ItemCategory> byId,
                                                     Map<String, String> accountNames) {
        ResolvedAccount inventoryAccount = resolveAccount(node, byId, ItemCategory::getDefaultInventoryAccountCode);
        ResolvedAccount costAccount = resolveAccount(node, byId, ItemCategory::getDefaultCostAccountCode);
        ResolvedAccount wasteAccount = resolveAccount(node, byId, ItemCategory::getDefaultWasteAccountCode);
        return new ResolvedGlAccountsDto(
                inventoryAccount.code(), costAccount.code(), wasteAccount.code(),
                inventoryAccount.inherited(), costAccount.inherited(), wasteAccount.inherited(),
                nameOf(inventoryAccount, accountNames), nameOf(costAccount, accountNames),
                nameOf(wasteAccount, accountNames),
                // Where the inherited value came from, so the form can say "Inherited from
                // Proteins" instead of leaving the manager to work out why a field they never
                // filled in already shows a value.
                sourceName(inventoryAccount, byId), sourceName(costAccount, byId),
                sourceName(wasteAccount, byId));
    }

    /** Null when the account has no code, or when finance-service was unreachable for this read. */
    private static String nameOf(ResolvedAccount account, Map<String, String> accountNames) {
        return account.code() == null ? null : accountNames.get(account.code());
    }

    private static String sourceName(ResolvedAccount account, Map<UUID, ItemCategory> byId) {
        if (!account.inherited() || account.sourceCategoryId() == null) {
            return null;
        }
        ItemCategory source = byId.get(account.sourceCategoryId());
        return source == null ? null : source.getName();
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
            return new ResolvedAccount(own, false, null);
        }
        UUID parentId = node.getParentId();
        while (parentId != null) {
            ItemCategory ancestor = byId.get(parentId);
            if (ancestor == null) {
                break;
            }
            String ancestorCode = accessor.apply(ancestor);
            if (ancestorCode != null && !ancestorCode.isBlank()) {
                return new ResolvedAccount(ancestorCode, true, ancestor.getId());
            }
            parentId = ancestor.getParentId();
        }
        return new ResolvedAccount(null, false, null);
    }

    /** {@code sourceCategoryId} is the ancestor the value came from, null when it is the node's own. */
    private record ResolvedAccount(String code, boolean inherited, UUID sourceCategoryId) {}

    private ItemCategoryDto toDto(ItemCategory c, Map<UUID, ItemCategory> byId, Map<UUID, Long> ingredientCounts,
                                   Map<String, String> accountNames) {
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
                resolveGlAccounts(c, byId, accountNames));
    }
}
