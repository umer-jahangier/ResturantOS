package io.restaurantos.pos.service;

import io.restaurantos.pos.dto.MenuCategoryDto;
import io.restaurantos.pos.dto.MenuItemDto;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;

import java.util.List;
import java.util.UUID;

public interface MenuService {
    List<MenuCategoryDto> listCategories();
    Page<MenuItemDto> listItems(UUID categoryId, UUID branchId, Pageable pageable);
    MenuItemDto getItem(UUID itemId, UUID branchId);
}
