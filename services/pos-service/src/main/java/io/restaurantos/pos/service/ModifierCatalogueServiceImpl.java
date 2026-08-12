package io.restaurantos.pos.service;

import io.restaurantos.pos.authz.PosAuthorizationService;
import io.restaurantos.pos.domain.model.MenuItem;
import io.restaurantos.pos.domain.model.Modifier;
import io.restaurantos.pos.domain.model.ModifierGroup;
import io.restaurantos.pos.dto.ModifierDtos.CreateModifierGroupRequest;
import io.restaurantos.pos.dto.ModifierDtos.CreateModifierRequest;
import io.restaurantos.pos.dto.ModifierDtos.ModifierGroupDto;
import io.restaurantos.pos.dto.ModifierDtos.ModifierOptionDto;
import io.restaurantos.pos.dto.ModifierDtos.UpdateModifierGroupRequest;
import io.restaurantos.pos.dto.ModifierDtos.UpdateModifierRequest;
import io.restaurantos.pos.repository.MenuItemRepository;
import io.restaurantos.pos.repository.ModifierGroupRepository;
import io.restaurantos.pos.repository.ModifierRepository;
import io.restaurantos.shared.exception.DuplicateValueException;
import io.restaurantos.shared.exception.FieldValidationException;
import io.restaurantos.shared.exception.ResourceNotFoundException;
import io.restaurantos.shared.tenant.TenantContext;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.UUID;

/**
 * The modifier catalogue (S6) — the half of modifiers that never existed.
 *
 * <h2>Permissions</h2>
 *
 * <p>Reads are {@code pos.menu.view}; writes are {@code pos.menu.manage}. Deliberately NOT a new
 * permission code. Phase 19b's precedent — "verbs that share a noun and nothing else do not share a
 * permission" — cuts the other way here: deciding that a Chicken Karahi can be ordered mild, medium
 * or hot IS menu work, done by the same person, at the same time, on the same screen as deciding
 * what the Karahi costs. {@code pos.menu.manage} already governs the price; a separate code would
 * have meant a manager who can re-price a dish cannot say it comes in three heats.
 *
 * <p>Gates are asserted here AND declared on the controller, the same belt-and-braces every other
 * pos admin surface uses: the annotation is what a reader of the route sees, the service check is
 * what survives being called from a consumer or a test that bypasses MVC.
 *
 * <h2>Retire, do not delete</h2>
 *
 * <p>{@code delete} soft-deletes. A group or an option that has been rung on historical checks must
 * stay readable — order lines snapshot the name and the price, so the bill is safe either way, but
 * a report that joins back to the catalogue is not. {@code active=false} is the everyday way to
 * take something off the till without losing it.
 */
@Service
@Transactional(readOnly = true)
public class ModifierCatalogueServiceImpl implements ModifierCatalogueService {

    private final ModifierGroupRepository groupRepository;
    private final ModifierRepository modifierRepository;
    private final MenuItemRepository menuItemRepository;
    private final TenantContext tenantContext;
    private final PosAuthorizationService authorization;

    public ModifierCatalogueServiceImpl(ModifierGroupRepository groupRepository,
                                        ModifierRepository modifierRepository,
                                        MenuItemRepository menuItemRepository,
                                        TenantContext tenantContext,
                                        PosAuthorizationService authorization) {
        this.groupRepository = groupRepository;
        this.modifierRepository = modifierRepository;
        this.menuItemRepository = menuItemRepository;
        this.tenantContext = tenantContext;
        this.authorization = authorization;
    }

    // ── Reads ────────────────────────────────────────────────────────────────────────────────

    @Override
    public List<ModifierGroupDto> listForItem(UUID menuItemId) {
        authorization.requireMenuView();
        UUID tenantId = tenantContext.requireTenantId();
        return groupRepository.findForItem(tenantId, menuItemId).stream()
                .filter(ModifierGroup::isActive)
                .map(g -> toDto(g, false))
                .toList();
    }

    @Override
    public List<ModifierGroupDto> listAllActive() {
        authorization.requireMenuView();
        UUID tenantId = tenantContext.requireTenantId();
        return groupRepository.findAllActiveForTenant(tenantId).stream()
                .map(g -> toDto(g, false))
                .toList();
    }

    @Override
    public List<ModifierGroupDto> listForItemAdmin(UUID menuItemId) {
        authorization.requireMenuManage();
        UUID tenantId = tenantContext.requireTenantId();
        requireItem(tenantId, menuItemId);
        return groupRepository.findForItem(tenantId, menuItemId).stream()
                .map(g -> toDto(g, true))
                .toList();
    }

    // ── Group writes ─────────────────────────────────────────────────────────────────────────

    @Override
    @Transactional
    public ModifierGroupDto createGroup(UUID menuItemId, CreateModifierGroupRequest request) {
        authorization.requireMenuManage();
        UUID tenantId = tenantContext.requireTenantId();
        MenuItem item = requireItem(tenantId, menuItemId);
        String name = request.name().trim();

        assertBounds(request.required(), request.minSelect(), request.maxSelect());
        groupRepository.findByItemAndName(tenantId, menuItemId, name).ifPresent(existing -> {
            throw new DuplicateValueException("name",
                    item.getName() + " already has a group called \"" + existing.getName()
                            + "\". Edit that group, or choose a different name.");
        });

        ModifierGroup group = new ModifierGroup();
        group.setTenantId(tenantId);
        group.setMenuItem(item);
        group.setName(name);
        group.setRequired(request.required());
        group.setMinSelect(request.minSelect());
        group.setMaxSelect(request.maxSelect());
        group.setSortOrder(request.sortOrder() == null ? 0 : request.sortOrder());
        group.setActive(true);
        return toDto(groupRepository.save(group), true);
    }

    /**
     * <h2>A group cannot be saved with a minimum its own options cannot satisfy</h2>
     *
     * <p>"Choose exactly 2" over a group holding one option is a dialog with no exit: the cashier
     * can neither satisfy it nor dismiss it, and the dish becomes unsellable at the till. It is
     * caught here, on the screen that created it, rather than an hour later on a queue.
     *
     * <p>The check is only made when the minimum RISES or the group is already populated — a group
     * created empty and filled in the next two clicks is the normal way this screen is used.
     */
    @Override
    @Transactional
    public ModifierGroupDto updateGroup(UUID groupId, UpdateModifierGroupRequest request) {
        authorization.requireMenuManage();
        UUID tenantId = tenantContext.requireTenantId();
        ModifierGroup group = requireGroup(tenantId, groupId);
        String name = request.name().trim();

        assertBounds(request.required(), request.minSelect(), request.maxSelect());

        long liveOptions = modifierRepository.countActiveInGroup(tenantId, groupId);
        if (liveOptions > 0 && request.minSelect() > liveOptions) {
            throw new FieldValidationException("MODIFIER_GROUP_UNSATISFIABLE", "minSelect",
                    "\"" + name + "\" holds " + liveOptions
                            + (liveOptions == 1 ? " option" : " options")
                            + ", so a cashier cannot choose " + request.minSelect()
                            + ". Add more options first, or lower the minimum.");
        }

        groupRepository.findByItemAndName(tenantId, group.getMenuItem().getId(), name)
                .filter(other -> !other.getId().equals(groupId))
                .ifPresent(other -> {
                    throw new DuplicateValueException("name",
                            "This dish already has a group called \"" + other.getName()
                                    + "\". Choose a different name.");
                });

        group.setName(name);
        group.setRequired(request.required());
        group.setMinSelect(request.minSelect());
        group.setMaxSelect(request.maxSelect());
        group.setSortOrder(request.sortOrder());
        group.setActive(request.active());
        return toDto(groupRepository.save(group), true);
    }

    @Override
    @Transactional
    public void deleteGroup(UUID groupId) {
        authorization.requireMenuManage();
        UUID tenantId = tenantContext.requireTenantId();
        ModifierGroup group = requireGroup(tenantId, groupId);
        Instant now = Instant.now();
        group.setDeletedAt(now);
        group.setActive(false);
        // Its options go with it — a live option under a deleted group would still be findable by
        // id, which is precisely the kind of orphan the resolver would then have to guess about.
        for (Modifier option : group.getModifiers()) {
            if (option.getDeletedAt() == null) {
                option.setDeletedAt(now);
                option.setActive(false);
            }
        }
        groupRepository.save(group);
    }

    // ── Option writes ────────────────────────────────────────────────────────────────────────

    @Override
    @Transactional
    public ModifierOptionDto createOption(UUID groupId, CreateModifierRequest request) {
        authorization.requireMenuManage();
        UUID tenantId = tenantContext.requireTenantId();
        ModifierGroup group = requireGroup(tenantId, groupId);
        String name = request.name().trim();

        modifierRepository.findByGroupAndName(tenantId, groupId, name).ifPresent(existing -> {
            throw new DuplicateValueException("name",
                    "\"" + group.getName() + "\" already offers \"" + existing.getName()
                            + "\". Edit that option, or choose a different name.");
        });

        Modifier option = new Modifier();
        option.setTenantId(tenantId);
        option.setModifierGroup(group);
        option.setName(name);
        option.setPriceDeltaPaisa(request.priceDeltaPaisa());
        option.setSortOrder(request.sortOrder() == null ? 0 : request.sortOrder());
        option.setActive(true);
        return toDto(modifierRepository.save(option));
    }

    @Override
    @Transactional
    public ModifierOptionDto updateOption(UUID modifierId, UpdateModifierRequest request) {
        authorization.requireMenuManage();
        UUID tenantId = tenantContext.requireTenantId();
        Modifier option = requireOption(tenantId, modifierId);
        String name = request.name().trim();
        UUID groupId = option.getModifierGroup().getId();

        modifierRepository.findByGroupAndName(tenantId, groupId, name)
                .filter(other -> !other.getId().equals(modifierId))
                .ifPresent(other -> {
                    throw new DuplicateValueException("name",
                            "This group already offers \"" + other.getName()
                                    + "\". Choose a different name.");
                });

        // Deactivating the option that a forced group's minimum depends on would leave the dish
        // unsellable, so it is refused here for the same reason `updateGroup` refuses an
        // unsatisfiable minimum — and with the same instruction shape.
        if (!request.active() && option.isActive()) {
            ModifierGroup group = option.getModifierGroup();
            long remaining = modifierRepository.countActiveInGroup(tenantId, groupId) - 1;
            if (group.isActive() && group.getMinSelect() > remaining) {
                throw new FieldValidationException("MODIFIER_GROUP_UNSATISFIABLE", "active",
                        "\"" + group.getName() + "\" asks the cashier to choose "
                                + group.getMinSelect()
                                + ", and turning this off would leave only " + remaining
                                + ". Lower that group's minimum first, or retire the whole group.");
            }
        }

        option.setName(name);
        option.setPriceDeltaPaisa(request.priceDeltaPaisa());
        option.setSortOrder(request.sortOrder());
        option.setActive(request.active());
        return toDto(modifierRepository.save(option));
    }

    @Override
    @Transactional
    public void deleteOption(UUID modifierId) {
        authorization.requireMenuManage();
        UUID tenantId = tenantContext.requireTenantId();
        Modifier option = requireOption(tenantId, modifierId);
        ModifierGroup group = option.getModifierGroup();
        long remaining = modifierRepository.countActiveInGroup(tenantId, group.getId())
                - (option.isActive() ? 1 : 0);
        if (group.isActive() && group.getMinSelect() > remaining) {
            throw new FieldValidationException("MODIFIER_GROUP_UNSATISFIABLE", "id",
                    "\"" + group.getName() + "\" asks the cashier to choose "
                            + group.getMinSelect() + ", and removing this option would leave only "
                            + remaining + ". Lower that group's minimum first, or remove the group.");
        }
        option.setDeletedAt(Instant.now());
        option.setActive(false);
        modifierRepository.save(option);
    }

    // ── Internals ────────────────────────────────────────────────────────────────────────────

    /**
     * {@code required} and {@code minSelect} are the same fact, so they are refused when they
     * disagree rather than silently reconciled. A screen that sends {@code required=true,
     * minSelect=0} has a bug, and a server that quietly fixes it hides that bug until a cashier
     * meets a "forced" group they can skip.
     */
    private static void assertBounds(boolean required, int minSelect, int maxSelect) {
        List<FieldValidationException.Violation> violations = new ArrayList<>();
        if (minSelect > maxSelect) {
            violations.add(new FieldValidationException.Violation("minSelect",
                    "The fewest a cashier may choose (" + minSelect
                            + ") is more than the most (" + maxSelect + ")."));
        }
        if (required && minSelect < 1) {
            violations.add(new FieldValidationException.Violation("minSelect",
                    "A forced group must ask for at least one option. Set the minimum to 1, or"
                            + " make the group optional."));
        }
        if (!required && minSelect > 0) {
            violations.add(new FieldValidationException.Violation("required",
                    "This group asks for at least " + minSelect
                            + ", which makes it forced. Tick \"Required\", or set the minimum to 0."));
        }
        if (!violations.isEmpty()) {
            throw new FieldValidationException("MODIFIER_GROUP_BOUNDS_INVALID",
                    violations.get(0).instruction(), violations);
        }
    }

    private MenuItem requireItem(UUID tenantId, UUID menuItemId) {
        return menuItemRepository.findByIdAndTenantId(menuItemId, tenantId)
                .orElseThrow(() -> new ResourceNotFoundException("Menu item not found: " + menuItemId));
    }

    private ModifierGroup requireGroup(UUID tenantId, UUID groupId) {
        return groupRepository.findByIdAndTenantIdAndDeletedAtIsNull(groupId, tenantId)
                .orElseThrow(() -> new ResourceNotFoundException("Modifier group not found: " + groupId));
    }

    private Modifier requireOption(UUID tenantId, UUID modifierId) {
        return modifierRepository.findByIdAndTenantIdAndDeletedAtIsNull(modifierId, tenantId)
                .orElseThrow(() -> new ResourceNotFoundException("Modifier not found: " + modifierId));
    }

    private static ModifierGroupDto toDto(ModifierGroup group, boolean includeInactiveOptions) {
        List<Modifier> live = group.getModifiers().stream()
                .filter(m -> m.getDeletedAt() == null)
                .sorted(Comparator.comparingInt(Modifier::getSortOrder)
                        .thenComparing(Modifier::getName, String.CASE_INSENSITIVE_ORDER))
                .toList();
        List<ModifierOptionDto> options = live.stream()
                .filter(m -> includeInactiveOptions || m.isActive())
                .map(ModifierCatalogueServiceImpl::toDto)
                .toList();
        return new ModifierGroupDto(
                group.getId(),
                group.getMenuItem().getId(),
                group.getName(),
                group.isRequired(),
                group.getMinSelect(),
                group.getMaxSelect(),
                group.getSortOrder(),
                group.isActive(),
                live.size(),
                options);
    }

    private static ModifierOptionDto toDto(Modifier option) {
        return new ModifierOptionDto(
                option.getId(),
                option.getModifierGroup().getId(),
                option.getName(),
                option.getPriceDeltaPaisa(),
                option.getSortOrder(),
                option.isActive());
    }
}
