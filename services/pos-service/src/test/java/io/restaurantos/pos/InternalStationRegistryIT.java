package io.restaurantos.pos;

import io.restaurantos.pos.domain.model.Station;
import io.restaurantos.pos.domain.model.StationType;
import io.restaurantos.pos.dto.StationDto;
import io.restaurantos.pos.repository.StationRepository;
import io.restaurantos.pos.web.InternalPosController;
import io.restaurantos.shared.authz.OpaDecision;
import io.restaurantos.shared.tenant.TenantContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;

import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;

/**
 * {@code GET /internal/stations} — the seam kitchen-service reads the branch's station registry
 * through (S1 #17).
 *
 * <p>The two properties that matter to the consumer, and would each break it silently:
 *
 * <ul>
 *   <li><b>Inactive stations are RETURNED, not filtered.</b> kitchen-service needs to be TOLD a
 *       station was deactivated so it can retire its own projected board. Filtering them here
 *       would look identical, on the wire, to a station that never existed — and the KDS would
 *       keep a dead board on the wall forever.</li>
 *   <li><b>Another tenant's stations are never included.</b> {@code stations} is FORCE RLS, and the
 *       query also carries an explicit tenant predicate; this asserts the outcome rather than the
 *       mechanism, because Testcontainers runs as a superuser and superusers bypass row security —
 *       so the predicate is the part CI can actually prove.</li>
 * </ul>
 */
class InternalStationRegistryIT extends PosTestBase {

    @Autowired InternalPosController internalPosController;
    @Autowired StationRepository stationRepository;
    @Autowired TenantContext tenantContext;

    UUID tenantId;
    UUID branchId;

    @BeforeEach
    void setUp() {
        tenantId = UUID.randomUUID();
        branchId = UUID.randomUUID();
        tenantContext.set(tenantId, branchId, null, null);
        when(opaClient.evaluate(any(), any())).thenReturn(new OpaDecision(true));
    }

    private Station station(UUID owningTenant, UUID owningBranch, String code, String name,
                            StationType type, boolean active) {
        Station s = new Station();
        s.setTenantId(owningTenant);
        s.setBranchId(owningBranch);
        s.setCode(code);
        s.setName(name);
        s.setStationType(type);
        s.setActive(active);
        return stationRepository.save(s);
    }

    @Test
    void returnsEveryStationOfTheBranch_activeAndInactive_withCodeNameAndType() {
        station(tenantId, branchId, "BAR", "Main bar", StationType.BAR, true);
        station(tenantId, branchId, "PANTRY1", "Cold prep", StationType.PANTRY, true);
        station(tenantId, branchId, "OLDGRILL", "Retired line", StationType.KITCHEN, false);

        ResponseEntity<List<StationDto>> response =
                internalPosController.listStations(branchId, tenantId);

        assertThat(response.getStatusCode().value()).isEqualTo(200);
        assertThat(response.getBody()).extracting(StationDto::code)
                .as("an inactive station must still be reported — the consumer needs it to retire "
                        + "its own projected board, and omitting it is indistinguishable from a "
                        + "station that was never created")
                .containsExactlyInAnyOrder("BAR", "PANTRY1", "OLDGRILL");

        StationDto pantry = response.getBody().stream()
                .filter(s -> s.code().equals("PANTRY1")).findFirst().orElseThrow();
        assertThat(pantry.name()).isEqualTo("Cold prep");
        assertThat(pantry.stationType()).isEqualTo(StationType.PANTRY);
        assertThat(pantry.active()).isTrue();

        StationDto retired = response.getBody().stream()
                .filter(s -> s.code().equals("OLDGRILL")).findFirst().orElseThrow();
        assertThat(retired.active()).isFalse();
    }

    @Test
    void neverReturnsAnotherTenantsStations_norAnotherBranchOfThisTenant() {
        station(tenantId, branchId, "MINE", "Mine", StationType.KITCHEN, true);

        UUID otherTenant = UUID.randomUUID();
        UUID otherBranch = UUID.randomUUID();
        // Written under the other tenant's context, then read back under ours.
        tenantContext.set(otherTenant, otherBranch, null, null);
        station(otherTenant, otherBranch, "THEIRS", "Theirs", StationType.BAR, true);
        tenantContext.set(tenantId, branchId, null, null);
        station(tenantId, UUID.randomUUID(), "OTHERBRANCH", "Other branch", StationType.BAR, true);

        ResponseEntity<List<StationDto>> response =
                internalPosController.listStations(branchId, tenantId);

        assertThat(response.getBody()).extracting(StationDto::code).containsExactly("MINE");
    }

    @Test
    void aBranchWithNoStations_returnsAnEmptyList_notAnError() {
        // The consumer must be able to tell "this branch has none" from "I could not ask", and
        // that distinction starts here: a branch with nothing configured is a 200 and [].
        ResponseEntity<List<StationDto>> response =
                internalPosController.listStations(UUID.randomUUID(), tenantId);

        assertThat(response.getStatusCode().value()).isEqualTo(200);
        assertThat(response.getBody()).isEmpty();
    }
}
