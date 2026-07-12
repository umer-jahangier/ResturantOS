package io.restaurantos.pos.service;

import io.restaurantos.pos.domain.model.MenuCategory;
import io.restaurantos.pos.dto.MenuItemDto;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;

import java.util.List;
import java.util.UUID;

public interface MenuService {
    List<MenuCategory> listCategories();
    Page<MenuItemDto> listItems(UUID categoryId, UUID branchId, Pageable pageable);
    MenuItemDto getItem(UUID itemId, UUID branchId);
}
