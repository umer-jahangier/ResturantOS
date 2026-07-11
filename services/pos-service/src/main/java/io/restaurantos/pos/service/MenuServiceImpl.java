package io.restaurantos.pos.service;

import io.restaurantos.pos.domain.model.BranchMenuOverride;
import io.restaurantos.pos.domain.model.MenuCategory;
import io.restaurantos.pos.domain.model.MenuItem;
import io.restaurantos.pos.dto.MenuCategoryDto;
import io.restaurantos.pos.dto.MenuItemDto;
import io.restaurantos.pos.repository.BranchMenuOverrideRepository;
import io.restaurantos.pos.repository.MenuCategoryRepository;
import io.restaurantos.pos.repository.MenuItemRepository;
import io.restaurantos.shared.exception.ResourceNotFoundException;
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

    public MenuServiceImpl(MenuCategoryRepository categoryRepository,
                           MenuItemRepository itemRepository,
                           BranchMenuOverrideRepository overrideRepository) {
        this.categoryRepository = categoryRepository;
        this.itemRepository = itemRepository;
        this.overrideRepository = overrideRepository;
    }

    @Override
    public List<MenuCategoryDto> listCategories() {
        return categoryRepository.findAllActiveOrderBySortOrder().stream()
                .map(c -> new MenuCategoryDto(c.getId(), c.getName(), c.getDescription(), c.getSortOrder(), c.isActive()))
                .toList();
    }

    @Override
    public Page<MenuItemDto> listItems(UUID categoryId, UUID branchId, Pageable pageable) {
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
        MenuItem item = itemRepository.findById(itemId)
                .orElseThrow(() -> new ResourceNotFoundException("Menu item not found: " + itemId));
        return toDto(item, branchId);
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
                overridePrice
        );
    }
}
