package io.restaurantos.pos.service;

import io.restaurantos.pos.domain.model.BranchMenuOverride;
import io.restaurantos.pos.domain.model.MenuCategory;
import io.restaurantos.pos.domain.model.MenuItem;
import io.restaurantos.pos.dto.MenuCategoryDto;
import io.restaurantos.pos.dto.MenuItemDto;
import io.restaurantos.pos.domain.model.Station;
import io.restaurantos.pos.repository.BranchMenuOverrideRepository;
import io.restaurantos.pos.repository.MenuCategoryRepository;
import io.restaurantos.pos.repository.MenuItemRepository;
import io.restaurantos.pos.repository.StationRepository;
import io.restaurantos.shared.exception.PermissionDeniedException;
import io.restaurantos.shared.exception.ResourceNotFoundException;
import io.restaurantos.shared.tenant.TenantContext;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Service
@Transactional(readOnly = true)
public class MenuServiceImpl implements MenuService {

    private final MenuCategoryRepository categoryRepository;
    private final MenuItemRepository itemRepository;
    private final BranchMenuOverrideRepository overrideRepository;
    private final StationRepository stationRepository;
    private final TenantContext tenantContext;

    public MenuServiceImpl(MenuCategoryRepository categoryRepository,
                           MenuItemRepository itemRepository,
                           BranchMenuOverrideRepository overrideRepository,
                           StationRepository stationRepository,
                           TenantContext tenantContext) {
        this.categoryRepository = categoryRepository;
        this.itemRepository = itemRepository;
        this.overrideRepository = overrideRepository;
        this.stationRepository = stationRepository;
        this.tenantContext = tenantContext;
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
