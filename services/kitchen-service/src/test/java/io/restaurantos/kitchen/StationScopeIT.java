package io.restaurantos.kitchen;

import io.restaurantos.kitchen.authz.KdsAuthorizationService;
import io.restaurantos.kitchen.authz.StationScope;
import io.restaurantos.kitchen.domain.model.KdsStation;
import io.restaurantos.kitchen.event.KitchenEventPayloads.OrderSentToKdsItem;
import io.restaurantos.kitchen.event.KitchenEventPayloads.OrderSentToKdsPayload;
import io.restaurantos.kitchen.repository.KdsStationRepository;
import io.restaurantos.kitchen.repository.KdsTicketRepository;
import io.restaurantos.kitchen.service.TicketRoutingService;
import io.restaurantos.kitchen.web.KdsController;
import io.restaurantos.shared.authz.OpaDecision;
import io.restaurantos.shared.exception.PermissionDeniedException;
import io.restaurantos.shared.security.JwtClaims;
import io.restaurantos.shared.tenant.TenantContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.redis.core.ValueOperations;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.transaction.annotation.Transactional;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * A cook sees their own stations, and a cook with no assignment sees everything (28-07, D-28-02).
 *
 * <h2>The three tests that guard the entire installed base</h2>
 *
 * <p>{@link #anUnassignedUser_seesEveryTicketInTheBranch()},
 * {@link #anUnassignedUser_seesEveryStation()} and
 * {@link #anAttributePresentButEmpty_isAlsoUnrestricted()}. Every user in this product today has no
 * station assignment. If "no stations named" were read as "no stations permitted", every kitchen
 * screen in every tenant would go blank the moment this deployed — during service, with no error
 * anywhere, looking exactly like a product that had stopped receiving orders.
 *
 * <p>That is why the unassigned case is written as a first-class behaviour with its own tests
 * rather than as a fallback branch nobody exercises.
 */
@Transactional
class StationScopeIT extends KitchenTestBase {

    @Autowired KdsAuthorizationService authz;
    @Autowired KdsController kdsController;
    @Autowired TicketRoutingService ticketRoutingService;
    @Autowired KdsStationRepository stationRepository;
    @Autowired KdsTicketRepository ticketRepository;
    @Autowired TenantContext tenantContext;

    UUID tenantId;
    UUID branchId;

    @BeforeEach
    void setUp() {
        tenantId = UUID.randomUUID();
        branchId = UUID.randomUUID();
        tenantContext.set(tenantId, branchId, null, null);
        when(opaClient.evaluate(eq("kds"), any())).thenReturn(new OpaDecision(true));
        // This class drives the CONTROLLER, so it passes through FeatureFlagAspect, which reads
        // FEATURE_KDS out of Redis. StringRedisTemplate is a @MockitoBean in KitchenTestBase and
        // its opsForValue() returns null by default, which surfaces as a NullPointerException from
        // inside the aspect rather than as anything resembling a feature flag. FEATURE_KDS is on
        // for every tier in production, so "enabled" is the honest stub.
        ValueOperations<String, String> valueOps = mock(ValueOperations.class);
        when(stringRedisTemplate.opsForValue()).thenReturn(valueOps);
        when(valueOps.get(any())).thenReturn("true");
    }

    // ── Task 1: resolving the scope ──────────────────────────────────────────────────────────

    @Test
    void aTokenWithNoStationAttribute_isUnrestricted() {
        authenticateWithAttributes(Map.of());

        assertThat(authz.resolveStationScope().isUnrestricted())
                .as("the do-nothing default, and the state every user in the product is in")
                .isTrue();
    }

    @Test
    void aTokenWithTwoStationCodes_isRestrictedToExactlyThose() {
        authenticateWithAttributes(Map.of("stations", List.of("BAR", "PASS")));

        StationScope scope = authz.resolveStationScope();
        assertThat(scope.isUnrestricted()).isFalse();
        assertThat(scope.permits("BAR")).isTrue();
        assertThat(scope.permits("PASS")).isTrue();
        assertThat(scope.permits("GRILL")).isFalse();
    }

    @Test
    void anAttributePresentButEmpty_isAlsoUnrestricted() {
        authenticateWithAttributes(Map.of("stations", List.of()));

        assertThat(authz.resolveStationScope().isUnrestricted())
                .as("a malformed token degrades OPEN. Reading an empty list as an empty allow-list "
                        + "is how a kitchen screen goes blank mid-service.")
                .isTrue();
    }

    @Test
    void anAttributeOfAnUnexpectedShape_isUnrestrictedAndDoesNotThrow() {
        authenticateWithAttributes(Map.of("stations", "BAR"));

        assertThat(authz.resolveStationScope().isUnrestricted()).isTrue();
    }

    @Test
    void anUnrestrictedScopeReportsItselfThroughAPredicate_notAsAnEmptyCollection() {
        StationScope unrestricted = StationScope.unrestricted();

        assertThat(unrestricted.isUnrestricted()).isTrue();
        assertThat(unrestricted.permits("ANYTHING")).isTrue();
        assertThatThrownBy(unrestricted::permittedCodes)
                .as("there must be NO accessor that hands an unrestricted scope back as an empty "
                        + "collection — that is the shape a caller misreads as 'permitted: nothing'")
                .isInstanceOf(IllegalStateException.class);
    }

    @Test
    void aRestrictedScopeAnswersPerStation() {
        StationScope bar = StationScope.restrictedTo(List.of("BAR"));

        assertThat(bar.permits("BAR")).isTrue();
        assertThat(bar.permits("bar")).as("codes are compared case-insensitively").isTrue();
        assertThat(bar.permits("GRILL")).isFalse();
        assertThat(bar.permits(null)).isFalse();
    }

    // ── Task 2: applying the scope ───────────────────────────────────────────────────────────

    @Test
    void aBartenderAskingForTheBranchWideBoard_receivesBarTicketsOnly() {
        fireTicket("BAR", "Mojito");
        fireTicket("GRILL", "Biryani");
        authenticateWithAttributes(Map.of("stations", List.of("BAR")));

        assertThat(boardItemNames(null))
                .as("the bar does not need to see the biryani")
                .containsExactly("Mojito");
    }

    @Test
    void aKitchenUserAskingForTheBranchWideBoard_doesNotReceiveTheBarTickets() {
        fireTicket("BAR", "Mojito");
        fireTicket("GRILL", "Biryani");
        authenticateWithAttributes(Map.of("stations", List.of("GRILL")));

        assertThat(boardItemNames(null))
                .as("and the kitchen must not wait on the mojito")
                .containsExactly("Biryani");
    }

    @Test
    void anUnassignedUser_seesEveryTicketInTheBranch() {
        fireTicket("BAR", "Mojito");
        fireTicket("GRILL", "Biryani");
        authenticateWithAttributes(Map.of());

        assertThat(boardItemNames(null))
                .as("THE regression guard for every existing user in the product")
                .containsExactlyInAnyOrder("Mojito", "Biryani");
    }

    @Test
    void aScopedUserAskingExplicitlyForAStationOutsideTheirScope_getsAnEmptyPage() {
        fireTicket("GRILL", "Biryani");
        authenticateWithAttributes(Map.of("stations", List.of("BAR")));

        assertThat(boardItemNames("GRILL"))
                .as("an empty board is the honest answer to 'show me a station I do not work'. A "
                        + "403 would let a cook enumerate which stations exist by watching which "
                        + "requests fail.")
                .isEmpty();
    }

    @Test
    void aScopedUserOpeningATicketDetailOutsideTheirScope_isRefused() {
        UUID orderId = fireTicket("GRILL", "Biryani");
        UUID ticketId = ticketIdFor(orderId);
        authenticateWithAttributes(Map.of("stations", List.of("BAR")));

        assertThatThrownBy(() -> kdsController.getTicketDetail(ticketId, branchId, currentClaims()))
                .as("detail REFUSES rather than returning empty: a specific resource is named, and "
                        + "handing it back is the actual disclosure")
                .isInstanceOf(PermissionDeniedException.class);
    }

    @Test
    void theStationListReturnsOnlyTheScopedUsersStations() {
        fireTicket("BAR", "Mojito");
        fireTicket("GRILL", "Biryani");
        authenticateWithAttributes(Map.of("stations", List.of("BAR")));

        assertThat(stationCodes()).containsExactly("BAR");
    }

    @Test
    void anUnassignedUser_seesEveryStation() {
        fireTicket("BAR", "Mojito");
        fireTicket("GRILL", "Biryani");
        authenticateWithAttributes(Map.of());

        assertThat(stationCodes()).containsExactlyInAnyOrder("BAR", "GRILL");
    }

    @Test
    void theAutoSeedStillFiresForABranchWithNoStations_andIsVisibleToAnUnassignedUser() {
        authenticateWithAttributes(Map.of());

        assertThat(stationCodes())
                .as("a board that says 'no stations configured' when the real answer is 'nobody "
                        + "has set this up yet' is the same defect class as an error rendered as "
                        + "an empty state")
                .containsExactly("DEFAULT");
    }

    @Test
    void aScopedUserAtABranchOfOnlyOtherStations_doesNotTriggerASpuriousDefaultSeed() {
        // The scope filter runs AFTER the auto-seed, and the ordering is load-bearing. Filtering
        // first would make a bartender at a kitchen-only branch look like a branch with NO
        // stations, and the seed would then write a DEFAULT row into the tenant's database every
        // time they opened the screen.
        fireTicket("GRILL", "Biryani");
        authenticateWithAttributes(Map.of("stations", List.of("BAR")));

        assertThat(stationCodes()).isEmpty();
        assertThat(stationRepository.findByBranchIdAndActiveTrue(branchId))
                .extracting(KdsStation::getCode)
                .containsExactly("GRILL");
    }

    // ── Helpers ──────────────────────────────────────────────────────────────────────────────

    private UUID fireTicket(String stationCode, String itemName) {
        UUID orderId = UUID.randomUUID();
        ticketRoutingService.route(new OrderSentToKdsPayload(
                orderId, tenantId, branchId, "ORD-" + itemName,
                List.of(new OrderSentToKdsItem(UUID.randomUUID(), UUID.randomUUID(), itemName, 1,
                        stationCode, List.of(), null, null, null, null)),
                1, null, null, "DINE_IN"), "ORD-" + itemName);
        return orderId;
    }

    private UUID ticketIdFor(UUID orderId) {
        return ticketRepository.findByOrderId(orderId).getFirst().getId();
    }

    private List<String> boardItemNames(String stationCode) {
        return kdsController
                .getTickets(branchId, stationCode, "PENDING,COOKING,READY", currentClaims(),
                        PageRequest.of(0, 50))
                .getBody()
                .getContent().stream()
                .flatMap(t -> t.items().stream())
                .map(i -> i.name())
                .toList();
    }

    private List<String> stationCodes() {
        return kdsController.getStations(branchId, null, currentClaims()).getBody().stream()
                .map(KdsStation::getCode)
                .toList();
    }

    private JwtClaims currentClaims() {
        return (JwtClaims) SecurityContextHolder.getContext().getAuthentication().getPrincipal();
    }

    private void authenticateWithAttributes(Map<String, Object> attributes) {
        JwtClaims claims = new JwtClaims(UUID.randomUUID(), tenantId, branchId,
                List.of("KITCHEN_STAFF"), List.of("pos.kds.view", "pos.kds.update"),
                new HashMap<>(attributes), null);
        SecurityContextHolder.getContext().setAuthentication(
                new UsernamePasswordAuthenticationToken(claims, null, List.of()));
    }
}
