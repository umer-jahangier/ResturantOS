package io.restaurantos.pos.service;

import io.restaurantos.pos.domain.model.Modifier;
import io.restaurantos.pos.domain.model.ModifierGroup;
import io.restaurantos.pos.repository.ModifierGroupRepository;
import io.restaurantos.shared.exception.FieldValidationException;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * The ONE place a client-supplied list of modifier ids becomes named, priced order-line rows (S6).
 *
 * <h2>What this replaces</h2>
 *
 * <p>{@code OrderServiceImpl.addItem} used to do this, in five lines, with a comment reading
 * <em>"for simplicity use a direct lookup"</em>:
 *
 * <pre>
 *   oim.setModifierNameSnapshot(modifierId.toString());
 *   oim.setPriceDeltaPaisa(0L);
 * </pre>
 *
 * <p>There was no lookup. The name snapshot was the UUID and the price delta was zero — and both
 * of those go straight onto the kitchen ticket and the guest's printed bill, because
 * {@code KitchenTicketAssembler} and {@code ReceiptDocumentAssembler} have printed
 * {@code modifierNameSnapshot} since the day they were written. A guest ordering extra cheese was
 * charged nothing for it and the chef was handed a hex string.
 *
 * <h2>What it enforces, and why here</h2>
 *
 * <p>Every rule below is enforced on the SERVER, not only in the configure dialog. The dialog is
 * how a cashier is stopped from making the mistake; this is what makes the rule true — for the
 * quick-add path in Order Management, for an offline till replaying its outbox, and for anything
 * that ever speaks to {@code POST /orders/{id}/items} directly.
 *
 * <ol>
 *   <li>Every id must be a live option on THIS dish, in THIS tenant. An id from another dish or
 *       another tenant is refused, not priced — the same reasoning that made {@code addItem}
 *       resolve {@code menuItemId} through a tenant-scoped lookup rather than {@code findById}.</li>
 *   <li>No id twice. "Extra cheese, extra cheese" through a double-tap is a double charge.</li>
 *   <li>Each ACTIVE group's selection count must sit inside {@code [minSelect, maxSelect]}. A
 *       forced group with nothing chosen is refused by name — this is what "the dialog refuses to
 *       add the line until spice level is chosen" means when the dialog is bypassed.</li>
 * </ol>
 *
 * <p>INACTIVE groups are not enforced: retiring "Spice level" must stop it being a requirement, or
 * retiring a group would make the dish unsellable. Their options are still recognised, so an id
 * that arrives late gets "no longer available" rather than "not on this dish".
 *
 * <h2>Money</h2>
 *
 * <p>The delta is read from the catalogue row as BIGINT paisa and handed to
 * {@code OrderPricingCalculator.lineSubtotal}, which already sums deltas into the unit price before
 * multiplying by quantity. Nothing here does arithmetic; there is no float and no percentage. The
 * name and the delta are then SNAPSHOTTED onto {@code order_item_modifiers}, exactly like
 * {@code unitPriceSnapshot} and the tax rate on the same line — re-pricing "Extra cheese" next
 * month must not change what last month's bill says the guest paid.
 */
@Component
public class ModifierSelectionResolver {

    /** One resolved selection: the catalogue id, and the name and price to freeze onto the line. */
    public record ResolvedModifier(UUID modifierId, String name, long priceDeltaPaisa) {}

    private static final String FIELD = "modifierIds";
    private static final String CODE = "MODIFIER_SELECTION_INVALID";

    private final ModifierGroupRepository groupRepository;

    public ModifierSelectionResolver(ModifierGroupRepository groupRepository) {
        this.groupRepository = groupRepository;
    }

    /**
     * Resolve and validate one order line's modifier selection.
     *
     * @param tenantId    the caller's tenant — never taken from the request
     * @param menuItemId  the dish the line is for
     * @param dishName    used only in refusal text, so the cashier reads a dish and not a uuid
     * @param requested   the client-supplied ids; null and empty are the same thing
     * @return the selections in catalogue order (group sort, then option sort), so a ticket
     *         reprinted tomorrow lists them the same way it did today
     * @throws FieldValidationException 422, with the field the dialog binds to and an instruction
     *                                  naming the group and the number
     */
    public List<ResolvedModifier> resolve(UUID tenantId, UUID menuItemId, String dishName,
                                          List<UUID> requested) {
        List<UUID> ids = requested == null ? List.of() : requested;

        // The read is unconditional, including when nothing was selected. Skipping it on an empty
        // list is the tempting optimisation and it is exactly wrong: "nothing was selected" is the
        // case a FORCED group exists to refuse, and an addItem that never looks would let a check
        // reach the pass with no spice level on it.
        List<ModifierGroup> groups = groupRepository.findForItem(tenantId, menuItemId);
        if (groups.isEmpty() && ids.isEmpty()) {
            return List.of();
        }

        Map<UUID, Modifier> optionsById = new LinkedHashMap<>();
        Map<UUID, ModifierGroup> groupByOptionId = new LinkedHashMap<>();
        for (ModifierGroup group : groups) {
            for (Modifier option : group.getModifiers()) {
                if (option.getDeletedAt() != null) continue;
                optionsById.put(option.getId(), option);
                groupByOptionId.put(option.getId(), group);
            }
        }

        List<FieldValidationException.Violation> violations = new ArrayList<>();
        LinkedHashSet<UUID> unique = new LinkedHashSet<>();
        for (UUID id : ids) {
            if (id == null) continue;
            if (!unique.add(id)) {
                Modifier dup = optionsById.get(id);
                violations.add(new FieldValidationException.Violation(FIELD,
                        "\"" + (dup == null ? id : dup.getName())
                                + "\" was chosen twice. Remove one, or raise the quantity of the line instead."));
                continue;
            }
            Modifier option = optionsById.get(id);
            if (option == null) {
                violations.add(new FieldValidationException.Violation(FIELD,
                        "One of the chosen options is not on " + dishName
                                + ". Close this dialog, reopen it and choose again."));
                continue;
            }
            ModifierGroup group = groupByOptionId.get(id);
            if (!option.isActive() || !group.isActive()) {
                violations.add(new FieldValidationException.Violation(FIELD,
                        "\"" + option.getName() + "\" is no longer available on " + dishName
                                + ". Choose something else."));
            }
        }

        // Counting per group happens over the ids that SURVIVED the checks above, so a dish whose
        // only fault is one retired option is not also accused of leaving its group empty.
        Map<UUID, Integer> chosenPerGroup = new LinkedHashMap<>();
        for (UUID id : unique) {
            ModifierGroup group = groupByOptionId.get(id);
            Modifier option = optionsById.get(id);
            if (group == null || option == null || !option.isActive() || !group.isActive()) continue;
            chosenPerGroup.merge(group.getId(), 1, Integer::sum);
        }

        for (ModifierGroup group : groups) {
            if (!group.isActive()) continue;
            int chosen = chosenPerGroup.getOrDefault(group.getId(), 0);
            if (chosen < group.getMinSelect()) {
                violations.add(new FieldValidationException.Violation(FIELD,
                        group.getName() + ": choose " + expected(group)
                                + (chosen == 0 ? "." : " — you have chosen " + chosen + ".")));
            } else if (chosen > group.getMaxSelect()) {
                violations.add(new FieldValidationException.Violation(FIELD,
                        group.getName() + ": choose " + expected(group)
                                + " — you have chosen " + chosen + "."));
            }
        }

        if (!violations.isEmpty()) {
            throw new FieldValidationException(CODE, violations.get(0).instruction(), violations);
        }

        // Catalogue order, not request order: the ticket and the bill must list "Medium" above
        // "Extra cheese" the same way every time, and the cashier's tap order is not a fact about
        // the dish. `groups` is already sorted, and `group.getModifiers()` carries @OrderBy.
        List<ResolvedModifier> resolved = new ArrayList<>();
        for (ModifierGroup group : groups) {
            for (Modifier option : group.getModifiers()) {
                if (unique.contains(option.getId())) {
                    resolved.add(new ResolvedModifier(
                            option.getId(), option.getName(), option.getPriceDeltaPaisa()));
                }
            }
        }
        return resolved;
    }

    /** "exactly 1" / "at least 1" / "up to 3" / "between 2 and 4" — the phrase a person can act on. */
    private static String expected(ModifierGroup group) {
        int min = group.getMinSelect();
        int max = group.getMaxSelect();
        if (min == max) {
            return "exactly " + min + (min == 1 ? " option" : " options");
        }
        if (min == 0) {
            return "up to " + max + (max == 1 ? " option" : " options");
        }
        return "between " + min + " and " + max + " options";
    }
}
