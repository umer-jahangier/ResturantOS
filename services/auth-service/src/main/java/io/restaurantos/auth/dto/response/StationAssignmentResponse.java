package io.restaurantos.auth.dto.response;

import io.restaurantos.auth.entity.UserStationAssignmentEntity;

import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Collectors;

/**
 * A user's active station assignments at one branch.
 *
 * <p>Grouped by branch rather than returned as a flat row list, because that is the shape the admin
 * UI renders: a station picker appears underneath the branch it belongs to, and a flat list would
 * make every caller re-group it.
 *
 * <p>A branch the user has no assignments at simply does not appear. It is NOT returned with an
 * empty list, for the same reason the JWT claim is absent rather than empty: "no rows" means
 * unrestricted, and giving it a visible empty-list spelling invites a reader to render it as "no
 * access".
 */
public record StationAssignmentResponse(UUID branchId, List<String> stationCodes) {

    public static List<StationAssignmentResponse> groupByBranch(List<UserStationAssignmentEntity> rows) {
        Map<UUID, List<String>> byBranch = rows.stream()
            .filter(UserStationAssignmentEntity::isActive)
            .collect(Collectors.groupingBy(
                UserStationAssignmentEntity::getBranchId,
                Collectors.mapping(UserStationAssignmentEntity::getStationCode, Collectors.toList())));

        return byBranch.entrySet().stream()
            // Sorted at both levels so two reads of an unchanged assignment are byte-identical and
            // a UI diffing them does not redraw.
            .sorted(Map.Entry.comparingByKey())
            .map(e -> new StationAssignmentResponse(
                e.getKey(), e.getValue().stream().distinct().sorted().toList()))
            .sorted(Comparator.comparing(StationAssignmentResponse::branchId))
            .toList();
    }
}
