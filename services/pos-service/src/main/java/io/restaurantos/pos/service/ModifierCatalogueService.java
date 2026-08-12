package io.restaurantos.pos.service;

import io.restaurantos.pos.dto.ModifierDtos.CreateModifierGroupRequest;
import io.restaurantos.pos.dto.ModifierDtos.CreateModifierRequest;
import io.restaurantos.pos.dto.ModifierDtos.ModifierGroupDto;
import io.restaurantos.pos.dto.ModifierDtos.ModifierOptionDto;
import io.restaurantos.pos.dto.ModifierDtos.UpdateModifierGroupRequest;
import io.restaurantos.pos.dto.ModifierDtos.UpdateModifierRequest;

import java.util.List;
import java.util.UUID;

/** The modifier catalogue: groups of options attached to one dish (S6). */
public interface ModifierCatalogueService {

    /** Live, ACTIVE groups with their active options for one dish — the till's per-dish read. */
    List<ModifierGroupDto> listForItem(UUID menuItemId);

    /**
     * Every ACTIVE group in the tenant, with active options — what the till loads once, beside the
     * menu, so a tap opens the dialog with no network round trip inside it.
     */
    List<ModifierGroupDto> listAllActive();

    /** Every live group on one dish INCLUDING retired ones — the manage screen's read. */
    List<ModifierGroupDto> listForItemAdmin(UUID menuItemId);

    ModifierGroupDto createGroup(UUID menuItemId, CreateModifierGroupRequest request);

    ModifierGroupDto updateGroup(UUID groupId, UpdateModifierGroupRequest request);

    void deleteGroup(UUID groupId);

    ModifierOptionDto createOption(UUID groupId, CreateModifierRequest request);

    ModifierOptionDto updateOption(UUID modifierId, UpdateModifierRequest request);

    void deleteOption(UUID modifierId);
}
