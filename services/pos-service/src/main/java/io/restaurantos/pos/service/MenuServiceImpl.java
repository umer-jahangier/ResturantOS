package io.restaurantos.pos.service;

import io.restaurantos.pos.domain.model.BranchMenuOverride;
import io.restaurantos.pos.domain.model.MenuCategory;
import io.restaurantos.pos.domain.model.MenuItem;
import io.restaurantos.pos.dto.MenuCategoryDto;
import io.restaurantos.pos.dto.MenuItemAdminDtos.CreateMenuItemRequest;
import io.restaurantos.pos.dto.MenuItemAdminDtos.UpdateMenuItemRequest;
import io.restaurantos.pos.dto.MenuItemDto;
import io.restaurantos.pos.domain.model.Station;
import io.restaurantos.pos.event.PosEventPayloads.MenuItemDeletedPayload;
import io.restaurantos.pos.event.PosEventPayloads.MenuItemUpsertedPayload;
import io.restaurantos.pos.repository.BranchMenuOverrideRepository;
import io.restaurantos.pos.repository.MenuCategoryRepository;
import io.restaurantos.pos.repository.MenuItemRepository;
import io.restaurantos.pos.repository.StationRepository;
import io.restaurantos.shared.event.EventPublisher;
import io.restaurantos.shared.exception.PermissionDeniedException;
import io.restaurantos.shared.exception.ResourceNotFoundException;
import io.restaurantos.shared.tenant.TenantContext;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Service
@Transactional(readOnly = true)
public class MenuServiceImpl implements MenuService {

    private static final String POS_EXCHANGE = "pos.topic";
    private static final String MENU_ITEM_UPSERTED_KEY = "pos.menu_item.upserted";
    private static final String MENU_ITEM_UPSERTED_TYPE = "MENU_ITEM_UPSERTED";
    private static final String MENU_ITEM_DELETED_KEY = "pos.menu_item.deleted";
    private static final String MENU_ITEM_DELETED_TYPE = "MENU_ITEM_DELETED";

    private final MenuCategoryRepository categoryRepository;
    private final MenuItemRepository itemRepository;
    private final BranchMenuOverrideRepository overrideRepository;
    private final StationRepository stationRepository;
    private final TenantContext tenantContext;
    private final EventPublisher eventPublisher;

    public MenuServiceImpl(MenuCategoryRepository categoryRepository,
                           MenuItemRepository itemRepository,
                           BranchMenuOverrideRepository overrideRepository,
                           StationRepository stationRepository,
                           TenantContext tenantContext,
                           EventPublisher eventPublisher) {
        this.categoryRepository = categoryRepository;
        this.itemRepository = itemRepository;
        this.overrideRepository = overrideRepository;
        this.stationRepository = stationRepository;
        this.tenantContext = tenantContext;
        this.eventPublisher = eventPublisher;
    }

    @Override
    public List<MenuCategoryDto> listCategories() {
        return categoryRepository.findAllActiveOrderBySortOrder().stream()
                .map(c -> new MenuCategoryDto(c.getId(), c.getName(), c.getDescription(), c.getSortOrder(), c.isActive()))
                .toList();
    }

    @Override
    public Page<MenuItemDto> listItems(UUID categoryId, UUID branchId, Pageable pageable) {
        requireOwnBranchIfPresent(branchId);
        if (categoryId != null) {
            List<MenuItem> items = itemRepository.findByCategoryIdAndActiveTrue(categoryId);
            return org.springframework.data.support.PageableExecutionUtils.getPage(
                    items.stream()
                         .map(item -> toDto(item, branchId))
                         .toList(),
                    pageable,
                    items::size);
        }
        return itemRepository.findByActiveTrue(pageable)
                             .map(item -> toDto(item, branchId));
    }

    @Override
    public MenuItemDto getItem(UUID itemId, UUID branchId) {
        requireOwnBranchIfPresent(branchId);
        MenuItem item = itemRepository.findById(itemId)
                .orElseThrow(() -> new ResourceNotFoundException("Menu item not found: " + itemId));
        return toDto(item, branchId);
    }

    /**
     * SECURITY (branch isolation): {@code branchId} is an optional request parameter used to resolve
     * branch-specific override pricing. When supplied it must equal the caller's verified JWT branch —
     * otherwise a caller could read another branch's override prices. When absent, only tenant-scoped
     * base pricing is returned (no branch restriction needed).
     */
    private void requireOwnBranchIfPresent(UUID branchId) {
        if (branchId == null) {
            return;
        }
        UUID jwtBranchId = tenantContext.getBranchId()
                .orElseThrow(() -> new PermissionDeniedException("Branch context required"));
        if (!jwtBranchId.equals(branchId)) {
            throw new PermissionDeniedException("Cannot access menu pricing for a different branch");
        }
    }

    @Override
    @Transactional
    public MenuItemDto assignStation(UUID itemId, UUID branchId, UUID stationId) {
        requireOwnBranchIfPresent(branchId);
        if (branchId == null) {
            throw new PermissionDeniedException("branchId is required to assign a station");
        }
        MenuItem item = itemRepository.findById(itemId)
                .orElseThrow(() -> new ResourceNotFoundException("Menu item not found: " + itemId));

        if (stationId == null) {
            // Clear the assignment — leave the free-text kds_station untouched (back-compat).
            item.setStationId(null);
        } else {
            // Validate the station belongs to the caller's tenant (RLS) AND branch — a client
            // cannot assign a sibling branch's station id to a menu item.
            Station station = stationRepository.findByIdAndBranchId(stationId, branchId)
                    .orElseThrow(() -> new ResourceNotFoundException("Station not found for this branch: " + stationId));
            item.setStationId(station.getId());
            // Keep the retained free-text mirror in sync so back-compat routing (and any reader
            // still on kds_station) resolves to the same canonical code.
            item.setKdsStation(station.getCode());
        }
        return toDto(itemRepository.save(item), branchId);
    }

    @Override
    @Transactional
    public MenuItemDto createItem(CreateMenuItemRequest request) {
        MenuCategory category = categoryRepository.findById(request.categoryId())
                .orElseThrow(() -> new ResourceNotFoundException("Menu category not found: " + request.categoryId()));

        MenuItem item = new MenuItem();
        item.setTenantId(tenantContext.requireTenantId());
        item.setCategory(category);
        item.setName(request.name());
        item.setDescription(request.description());
        item.setBasePricePaisa(request.basePricePaisa());
        if (request.taxRatePct() != null) {
            item.setTaxRatePct(request.taxRatePct());
        }
        item.setTaxRateCode(request.taxRateCode());
        item.setActive(true);

        MenuItem saved = itemRepository.save(item);
        publishUpserted(saved);
        return toDto(saved, null);
    }

    @Override
    @Transactional
    public MenuItemDto updateItem(UUID itemId, UpdateMenuItemRequest request) {
        MenuItem item = itemRepository.findById(itemId)
                .orElseThrow(() -> new ResourceNotFoundException("Menu item not found: " + itemId));

        if (request.categoryId() != null) {
            MenuCategory category = categoryRepository.findById(request.categoryId())
                    .orElseThrow(() -> new ResourceNotFoundException("Menu category not found: " + request.categoryId()));
            item.setCategory(category);
        }
        item.setName(request.name());
        item.setDescription(request.description());
        item.setBasePricePaisa(request.basePricePaisa());
        if (request.taxRatePct() != null) {
            item.setTaxRatePct(request.taxRatePct());
        }
        item.setTaxRateCode(request.taxRateCode());

        MenuItem saved = itemRepository.save(item);
        publishUpserted(saved);
        return toDto(saved, null);
    }

    @Override
    @Transactional
    public MenuItemDto setActive(UUID itemId, boolean active) {
        MenuItem item = itemRepository.findById(itemId)
                .orElseThrow(() -> new ResourceNotFoundException("Menu item not found: " + itemId));
        item.setActive(active);
        MenuItem saved = itemRepository.save(item);
        publishUpserted(saved);
        return toDto(saved, null);
    }

    @Override
    @Transactional
    public void deleteItem(UUID itemId) {
        MenuItem item = itemRepository.findById(itemId)
                .orElseThrow(() -> new ResourceNotFoundException("Menu item not found: " + itemId));
        item.setDeletedAt(Instant.now());
        item.setActive(false);
        itemRepository.save(item);
        eventPublisher.publish(POS_EXCHANGE, MENU_ITEM_DELETED_KEY, MENU_ITEM_DELETED_TYPE, null,
                new MenuItemDeletedPayload(item.getId()));
    }

    @Override
    @Transactional
    public int republishAllActive() {
        List<MenuItem> activeItems = itemRepository.findByActiveTrueOrderByName();
        for (MenuItem item : activeItems) {
            publishUpserted(item);
        }
        return activeItems.size();
    }

    /**
     * Uses {@code Instant.now()} for the payload's {@code updatedAt}, NOT
     * {@code item.getUpdatedAt()}: Spring Data JPA's {@code @LastModifiedDate} only refreshes the
     * in-memory field on flush/commit for an update (merge), so reading it back immediately after
     * {@code save()} inside the same still-open transaction can return a stale value.
     */
    private void publishUpserted(MenuItem item) {
        var payload = new MenuItemUpsertedPayload(
                item.getId(),
                item.getName(),
                item.getCategory().getId(),
                item.getCategory().getName(),
                item.isActive(),
                item.getBasePricePaisa(),
                Instant.now()
        );
        eventPublisher.publish(POS_EXCHANGE, MENU_ITEM_UPSERTED_KEY, MENU_ITEM_UPSERTED_TYPE, null, payload);
    }

    private MenuItemDto toDto(MenuItem item, UUID branchId) {
        Long overridePrice = null;
        if (branchId != null) {
            Optional<BranchMenuOverride> override = overrideRepository
                    .findByBranchIdAndMenuItemId(branchId, item.getId());
            if (override.isPresent() && override.get().getPricePaisa() != null) {
                overridePrice = override.get().getPricePaisa();
            }
        }
        return new MenuItemDto(
                item.getId(),
                item.getCategory().getId(),
                item.getCategory().getName(),
                item.getName(),
                item.getDescription(),
                item.getBasePricePaisa(),
                item.getTaxRatePct(),
                item.getTaxRateCode(),
                item.getKdsStation(),
                item.isActive(),
                overridePrice,
                item.getStationId()
        );
    }
}
