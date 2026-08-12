package io.restaurantos.kitchen;

import io.restaurantos.kitchen.client.PosStationClient.PosStation;
import io.restaurantos.kitchen.domain.model.KdsStation;
import io.restaurantos.kitchen.domain.model.StationType;
import io.restaurantos.kitchen.repository.KdsStationRepository;
import io.restaurantos.kitchen.web.KdsController;
import io.restaurantos.shared.authz.OpaDecision;
import io.restaurantos.shared.security.JwtClaims;
import io.restaurantos.shared.tenant.TenantContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.redis.core.ValueOperations;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * The KDS station REGISTRY — S1 #17 / #18.
 *
 * <h2>The defect these tests would have caught</h2>
 *
 * <p>{@code kds_stations} had exactly one writer: the ticket-routing path. A station therefore
 * became visible on the KDS only when its FIRST TICKET arrived. An admin could create PANTRY1 at
 * {@code /app/stations} and get no pantry board and no pantry entry in the station picker — and
 * {@code GET /kitchen/kds/stations} papered over the resulting empty list by inventing a DEFAULT
 * row, so the screen looked healthy while showing a station that exists in no registry.
 *
 * <p>Measured live at branch F-7 before the fix: {@code GET /api/v1/pos/stations} returned BAR,
 * GRILL, DGB28334, DGS43431, DGS20334; {@code GET /api/v1/kitchen/kds/stations} returned DEFAULT,
 * GRILL, BAR. Three real stations invisible, one phantom present.
 *
 * <p>{@link #newlyCreatedStation_isVisible_withoutEverReceivingATicket} is the falsification test:
 * NO ticket is routed anywhere in it. Against the pre-fix controller it fails, because the only
 * code that could ever have created a PANTRY1 row is the code that routes tickets.
 */
@Transactional
class StationRegistryIT extends KitchenTestBase {

    @Autowired KdsController kdsController;
    @Autowired KdsStationRepository stationRepository;
    @Autowired TenantContext tenantContext;

    UUID tenantId;
    UUID branchId;

    @BeforeEach
    void setUp() {
        tenantId = UUID.randomUUID();
        branchId = UUID.randomUUID();
        tenantContext.set(tenantId, branchId, null, null);

        JwtClaims claims = new JwtClaims(UUID.randomUUID(), tenantId, branchId,
                List.of("KITCHEN_STAFF"), List.of("pos.kds.view", "pos.kds.update"), Map.of(), null);
        SecurityContextHolder.getContext().setAuthentication(
                new UsernamePasswordAuthenticationToken(claims, null, List.of()));
        when(opaClient.evaluate(eq("kds"), any())).thenReturn(new OpaDecision(true));

        // KdsController is @RequiresFeature("FEATURE_KDS") — calling it directly routes through
        // RedisFeatureFlagService, which needs a non-null opsForValue() on the mocked
        // StringRedisTemplate (otherwise it NPEs before the endpoint's own logic runs).
        @SuppressWarnings("unchecked")
        ValueOperations<String, String> valueOps = mock(ValueOperations.class);
        when(stringRedisTemplate.opsForValue()).thenReturn(valueOps);
        when(valueOps.get(any())).thenReturn("true");
    }

    private JwtClaims claims() {
        return (JwtClaims) SecurityContextHolder.getContext().getAuthentication().getPrincipal();
    }

    private void registryHolds(PosStation... stations) {
        when(posStationClient.listStations(tenantId, branchId))
                .thenReturn(Optional.of(List.of(stations)));
    }

    /**
     * THE ONE THAT MATTERS. An admin creates PANTRY1; nobody rings a pantry item; the pantry cook
     * opens the KDS and the board is there.
     */
    @Test
    void newlyCreatedStation_isVisible_withoutEverReceivingATicket() {
        UUID posStationId = UUID.randomUUID();
        registryHolds(new PosStation(posStationId, "PANTRY1", "Cold prep", true, "PANTRY"));

        // Not one ticket has ever been routed at this branch — TicketRoutingService is never
        // called anywhere in this class, which is the whole point. branchId is freshly random per
        // test, so no other test's tickets can be reached under it either.
        ResponseEntity<List<KdsStation>> response =
                kdsController.getStations(branchId, null, claims());

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(response.getBody()).extracting(KdsStation::getCode).containsExactly("PANTRY1");
        KdsStation projected = response.getBody().get(0);
        assertThat(projected.getName()).isEqualTo("Cold prep");
        assertThat(projected.getStationType()).isEqualTo(StationType.PANTRY);
        assertThat(projected.getSourceStationId()).isEqualTo(posStationId);
        assertThat(projected.isActive()).isTrue();
    }

    /**
     * The phantom the old auto-seed invented. A branch whose registry says "nothing here" must say
     * so, not conjure a DEFAULT station that exists in no registry.
     */
    @Test
    void emptyRegistry_doesNotInventADefaultStation() {
        registryHolds();

        ResponseEntity<List<KdsStation>> response =
                kdsController.getStations(branchId, null, claims());

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(response.getBody()).isEmpty();
        assertThat(stationRepository.findByBranchIdAndCode(branchId, "DEFAULT")).isEmpty();
    }

    /**
     * "Could not read the registry" is not "you have no stations" — the distinction the whole
     * repair turns on. With nothing projected yet and pos-service unreachable, the endpoint must
     * refuse rather than render a confident empty board on a kitchen wall.
     */
    @Test
    void unreadableRegistry_withNothingProjected_refusesRatherThanReportingNoStations() {
        // The default mock answer for an Optional-returning method is Optional.empty(), which is
        // exactly "pos-service could not be read". Stated explicitly so the test does not depend
        // on that default staying true.
        when(posStationClient.listStations(tenantId, branchId)).thenReturn(Optional.empty());

        ResponseEntity<List<KdsStation>> response =
                kdsController.getStations(branchId, null, claims());

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.SERVICE_UNAVAILABLE);
    }

    /**
     * ...but an unreadable registry must NOT black out a kitchen that already has boards. The
     * projection is the fallback, which is the entire reason kds_stations is a projection rather
     * than a lookup.
     */
    @Test
    void unreadableRegistry_keepsTheProjectionItAlreadyHad() {
        registryHolds(new PosStation(UUID.randomUUID(), "GRILL", "Hot line", true, "KITCHEN"));
        kdsController.getStations(branchId, null, claims());

        when(posStationClient.listStations(tenantId, branchId)).thenReturn(Optional.empty());
        ResponseEntity<List<KdsStation>> response =
                kdsController.getStations(branchId, null, claims());

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(response.getBody()).extracting(KdsStation::getCode).containsExactly("GRILL");
    }

    /** pos owns the name and the type; a rename there reaches the board without a ticket. */
    @Test
    void renameInTheRegistry_reachesTheProjection() {
        UUID posStationId = UUID.randomUUID();
        registryHolds(new PosStation(posStationId, "BAR", "Main bar", true, "BAR"));
        kdsController.getStations(branchId, null, claims());

        registryHolds(new PosStation(posStationId, "BAR", "Rooftop bar", true, "BAR"));
        ResponseEntity<List<KdsStation>> response =
                kdsController.getStations(branchId, null, claims());

        assertThat(response.getBody()).hasSize(1);
        assertThat(response.getBody().get(0).getName()).isEqualTo("Rooftop bar");
        assertThat(response.getBody().get(0).getStationType()).isEqualTo(StationType.BAR);
    }

    /** Deactivating a station in pos retires its board, rather than leaving a dead screen up. */
    @Test
    void deactivationInTheRegistry_retiresTheProjectedStation() {
        UUID posStationId = UUID.randomUUID();
        registryHolds(new PosStation(posStationId, "DGS20334", "Diag Dessert", true, "DESSERT"));
        assertThat(kdsController.getStations(branchId, null, claims()).getBody()).hasSize(1);

        registryHolds(new PosStation(posStationId, "DGS20334", "Diag Dessert", false, "DESSERT"));
        ResponseEntity<List<KdsStation>> response =
                kdsController.getStations(branchId, null, claims());

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(response.getBody()).isEmpty();
        // The row survives, deactivated — its tickets are still addressable by code.
        assertThat(stationRepository.findByBranchIdAndCode(branchId, "DGS20334"))
                .get().extracting(KdsStation::isActive).isEqualTo(false);
    }

    /**
     * A projected row the registry does not name is LEFT ALONE. DEFAULT is such a row — every
     * unrouted item in the product lands on it — and reconciling it away would black out the only
     * board most tenants have.
     */
    @Test
    void rowsTheRegistryDoesNotName_areLeftAlone() {
        KdsStation legacy = new KdsStation();
        legacy.setTenantId(tenantId);
        legacy.setBranchId(branchId);
        legacy.setCode("DEFAULT");
        legacy.setName("DEFAULT");
        legacy.setActive(true);
        legacy.setStationType(StationType.DEFAULT);
        legacy.setEscalationThresholdSeconds(900);
        stationRepository.save(legacy);

        registryHolds(new PosStation(UUID.randomUUID(), "GRILL", "Hot line", true, "KITCHEN"));
        ResponseEntity<List<KdsStation>> response =
                kdsController.getStations(branchId, null, claims());

        assertThat(response.getBody()).extracting(KdsStation::getCode)
                .containsExactlyInAnyOrder("DEFAULT", "GRILL");
    }
}
