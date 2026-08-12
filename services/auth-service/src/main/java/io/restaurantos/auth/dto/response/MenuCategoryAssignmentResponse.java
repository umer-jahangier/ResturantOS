package io.restaurantos.auth.dto.response;

import io.restaurantos.auth.entity.UserMenuCategoryAssignmentEntity;

import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Collectors;

/**
 * A user's active menu-category assignments at one branch (Program A).
 *
 * <p>Grouped by branch rather than returned flat, because that is the shape the admin UI renders: a
 * category picker appears underneath the branch it belongs to, and a flat list would make every
 * caller re-group it. Same shape and same reasoning as {@link StationAssignmentResponse}.
 *
 * <p>A branch the user has no assignments at simply does not appear. It is NOT returned with an
 * empty list, for the same reason the JWT claim is absent rather than empty and the table has no
 * {@code sells_all} flag: "no rows" means the whole menu, and giving that a visible empty-list
 * spelling invites a reader to render it as "no access" — which on a till screen is the difference
 * between an unconfigured cashier and one who cannot work.
 */
public record MenuCategoryAssignmentResponse(UUID branchId, List<UUID> categoryIds) {

    public static List<MenuCategoryAssignmentResponse> groupByBranch(
            List<UserMenuCategoryAssignmentEntity> rows) {
        Map<UUID, List<UUID>> byBranch = rows.stream()
            .filter(UserMenuCategoryAssignmentEntity::isActive)
            .collect(Collectors.groupingBy(
                UserMenuCategoryAssignmentEntity::getBranchId,
                Collectors.mapping(UserMenuCategoryAssignmentEntity::getCategoryId, Collectors.toList())));

        return byBranch.entrySet().stream()
            // Sorted at both levels so two reads of an unchanged assignment are byte-identical and
            // a UI diffing them does not redraw.
            .sorted(Map.Entry.comparingByKey())
            .map(e -> new MenuCategoryAssignmentResponse(
                e.getKey(), e.getValue().stream().distinct().sorted().toList()))
            .sorted(Comparator.comparing(MenuCategoryAssignmentResponse::branchId))
            .toList();
    }
}
