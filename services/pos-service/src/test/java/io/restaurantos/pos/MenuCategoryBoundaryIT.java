package io.restaurantos.pos;

import io.restaurantos.pos.authz.MenuCategoryScope;
import io.restaurantos.pos.authz.PosAuthorizationService;
import io.restaurantos.pos.domain.model.MenuCategory;
import io.restaurantos.pos.domain.model.MenuItem;
import io.restaurantos.pos.dto.AddOrderItemRequest;
import io.restaurantos.pos.dto.CreateOrderRequest;
import io.restaurantos.pos.dto.MenuCategoryDto;
import io.restaurantos.pos.dto.MenuItemDto;
import io.restaurantos.pos.dto.OrderDto;
import io.restaurantos.pos.repository.MenuCategoryRepository;
import io.restaurantos.pos.repository.MenuItemRepository;
import io.restaurantos.pos.repository.OrderRepository;
import io.restaurantos.pos.service.MenuService;
import io.restaurantos.pos.service.OrderService;
import io.restaurantos.shared.authz.DefaultOpaClient;
import io.restaurantos.shared.authz.OpaClient;
import io.restaurantos.shared.exception.PermissionDeniedException;
import io.restaurantos.shared.exception.ResourceNotFoundException;
import io.restaurantos.shared.security.JwtClaims;
import io.restaurantos.shared.tenant.TenantContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.domain.PageRequest;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.client.RestClient;
import org.testcontainers.containers.GenericContainer;
import org.testcontainers.containers.wait.strategy.Wait;
import org.testcontainers.utility.DockerImageName;
import org.testcontainers.utility.MountableFile;

import java.math.BigDecimal;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;

/**
 * The per-user MENU CATEGORY boundary — decided by the REAL {@code policies/} bundle (Program A).
 *
 * <h2>What was wrong</h2>
 *
 * <p>The product could already CONFIGURE a till that only sells drinks and could not ENFORCE it.
 * {@code V15__pos_terminals.sql} created {@code pos_terminal_categories} under a header naming the
 * feature by name, the admin screen has written rows into it since phase 28, and there are live rows
 * in it right now — for a terminal called "Bar till", configured with two categories, in production.
 * Nothing has ever read them: {@code PosTerminalCategoryRepository.findByTenantIdAndTerminalId} has
 * exactly one caller, {@code PosTerminalServiceImpl.toDto}, which echoes the list back to the form
 * that submitted it. {@code MenuController.listItems} took {@code (categoryId, branchId, pageable)}
 * and {@code OrderServiceImpl.addItem} made no authorization call at all. A config screen writing
 * rows nobody reads is this repository's defining defect, and this is the largest instance of it.
 *
 * <h2>What this file proves, and what it does not</h2>
 *
 * <p>It proves the REFUSAL, against the real engine holding the real bundle. Nothing here is
 * simulated: {@link PosTestBase}'s {@code @MockitoBean OpaClient} is re-stubbed to DELEGATE to a
 * real {@link DefaultOpaClient} — production's own client, with production's own snake_case Jackson
 * mapper — pointed at a Testcontainers OPA that holds a copy of this repository's {@code policies/}.
 * The rego evaluates the bytes the service actually sends. Same construction, same reasoning, as
 * {@code VoidOwnOrderIT}.
 *
 * <p>It does NOT prove the auth-service half. The claim this reads is minted by
 * {@code PermissionResolver.putMenuCategoryScope} in a different service and a different database;
 * here it is placed on the security context directly, which is what a verified token would have
 * produced. The two halves are pinned to each other only by the claim's spelling, and that risk is
 * stated rather than papered over — {@link #theClaimSpellingIsTheContractBetweenTwoServices} asserts
 * the literal string on this side.
 *
 * <h2>Falsification — watched, not assumed</h2>
 *
 * <p>Both directions were run before this file was trusted; the exact output is in the build report.
 * <ol>
 *   <li>Remove {@code posAuthorizationService.authorizeAddItem(...)} from
 *       {@code OrderServiceImpl.addItem}: {@link #cashierScopedToDrinksIsRefusedAFoodItem} fails —
 *       the food item is added and no exception is thrown. That proves the WIRING.</li>
 *   <li>Remove the two {@code pos.order.add_item} rules from {@code pos.rego}: the same test still
 *       passes (an undefined rule denies) but {@link #waiterWithNoAssignmentRingsAnything} fails
 *       with {@code PermissionDeniedException: Not permitted: pos.pos.order.add_item}. That proves
 *       the POLICY is what is deciding, and that the deny is not coming from somewhere else.</li>
 * </ol>
 * They fail for different reasons and only the pair distinguishes "the guard runs" from "the guard
 * decides".
 */
class MenuCategoryBoundaryIT extends PosTestBase {

    /**
     * Real OPA, real bundle. The policies are <b>copied</b> into the container rather than
     * bind-mounted, for the reason {@code VoidOwnOrderIT} records: a bind mount whose host path is
     * outside the Docker VM's shared directories silently resolves to an EMPTY {@code /policies},
     * and OPA then answers {@code {}} — read, correctly, as deny — for every query. That failure
     * mode makes every deny-assertion pass against an engine holding no policy at all, which is why
     * {@link #assertPolicyBundleIsActuallyLoaded} exists below.
     */
    @SuppressWarnings("resource")
    private static final GenericContainer<?> OPA =
            new GenericContainer<>(DockerImageName.parse("openpolicyagent/opa:1.17.1"))
                    .withCommand("run", "--server", "--addr=0.0.0.0:8181", "/policies")
                    .withExposedPorts(8181)
                    .withCopyFileToContainer(MountableFile.forHostPath(policiesDir()), "/policies")
                    .waitingFor(Wait.forHttp("/health").forPort(8181));

    static {
        OPA.start();
    }

    private static String opaBaseUrl() {
        return "http://" + OPA.getHost() + ":" + OPA.getMappedPort(8181);
    }

    private static Path policiesDir() {
        Path cwd = Path.of(System.getProperty("user.dir")).toAbsolutePath();
        for (Path candidate : List.of(
                cwd.resolve("../../policies").normalize(),
                cwd.resolve("policies").normalize(),
                cwd.resolve("../../../policies").normalize())) {
            if (candidate.resolve("restaurantos/pos.rego").toFile().exists()) {
                return candidate;
            }
        }
        throw new IllegalStateException("Could not locate policies/ from " + cwd);
    }

    @Autowired OrderService orderService;
    @Autowired MenuService menuService;
    @Autowired PosAuthorizationService posAuthorizationService;
    @Autowired MenuItemRepository menuItemRepository;
    @Autowired MenuCategoryRepository menuCategoryRepository;
    @Autowired OrderRepository orderRepository;
    @Autowired TenantContext tenantContext;

    UUID tenantId;
    UUID branchId;
    UUID cashierId;

    UUID drinksCategoryId;
    UUID foodCategoryId;
    UUID drinkItemId;
    UUID foodItemId;

    /** The permission the add-item endpoint already requires via {@code @PreAuthorize}. */
    private static final String ADD_ITEM_PERMISSION = "pos.order.update";

    @BeforeEach
    void setUp() {
        tenantId = UUID.randomUUID();
        branchId = UUID.randomUUID();
        cashierId = UUID.randomUUID();
        tenantContext.set(tenantId, branchId, cashierId, null);

        // The mock is a pass-through to the real policy bundle, never a canned answer. This REPLACES
        // PosTestBase's ambient allow-everything default, which runs first.
        OpaClient live = new DefaultOpaClient(RestClient.builder()
                .baseUrl(opaBaseUrl())
                .requestFactory(new JdkClientHttpRequestFactory())
                .build());
        when(opaClient.evaluate(any(), any()))
                .thenAnswer(call -> live.evaluate(call.getArgument(0), call.getArgument(1)));

        MenuCategory drinks = new MenuCategory();
        drinks.setTenantId(tenantId);
        drinks.setName("Drinks-" + UUID.randomUUID());
        drinks.setSortOrder(1);
        drinks = menuCategoryRepository.save(drinks);
        drinksCategoryId = drinks.getId();

        MenuCategory food = new MenuCategory();
        food.setTenantId(tenantId);
        food.setName("Mains-" + UUID.randomUUID());
        food.setSortOrder(2);
        food = menuCategoryRepository.save(food);
        foodCategoryId = food.getId();

        drinkItemId = saveItem(drinks, "Fresh Lime", 25000L);
        foodItemId = saveItem(food, "Nihari", 45000L);

        unrestricted();
    }

    private UUID saveItem(MenuCategory category, String name, long pricePaisa) {
        MenuItem item = new MenuItem();
        item.setTenantId(tenantId);
        item.setCategory(category);
        item.setName(name);
        item.setBasePricePaisa(pricePaisa);
        item.setTaxRatePct(new BigDecimal("0.00"));
        return menuItemRepository.save(item).getId();
    }

    /** A user with NO assignment — the state every user in the product is in today. */
    private void unrestricted() {
        setSecurityContext(Map.of());
    }

    /** A counter cashier confined to these categories, as a verified token would carry them. */
    private void scopedTo(UUID... categoryIds) {
        setSecurityContext(Map.of("menu_categories",
                java.util.Arrays.stream(categoryIds).map(UUID::toString).sorted().toList()));
    }

    private void setSecurityContext(Map<String, Object> attributes) {
        JwtClaims claims = new JwtClaims(
                cashierId, tenantId, branchId,
                List.of("CASHIER"), List.of(ADD_ITEM_PERMISSION, "pos.menu.view"), attributes, null);
        SecurityContextHolder.getContext().setAuthentication(
                new UsernamePasswordAuthenticationToken(claims, null, List.of()));
    }

    private OrderDto newCheck() {
        return orderService.createOrder(
                new CreateOrderRequest(branchId, UUID.randomUUID(), null, null, 1, null, null));
    }

    /**
     * Positive control. An OPA with no bundle denies everything and looks healthy doing it, so
     * before any refusal below is believed, prove the engine holds {@code restaurantos.pos} AND says
     * YES to an input it must permit. Runs as its own test so its failure names the harness rather
     * than being blamed on the policy.
     */
    @Test
    void assertPolicyBundleIsActuallyLoaded() {
        String modules = RestClient.builder().baseUrl(opaBaseUrl())
                .requestFactory(new JdkClientHttpRequestFactory()).build()
                .get().uri("/v1/policies").retrieve().body(String.class);
        assertThat(modules)
                .as("OPA is serving no policy module — the bundle never reached the container, and "
                        + "every refusal below would be a meaningless deny")
                .contains("restaurantos/pos.rego");

        // ...and it DECIDES rather than merely holding text: an unassigned caller is allowed.
        unrestricted();
        assertThatCode(() -> posAuthorizationService.authorizeAddItem(
                UUID.randomUUID(), tenantId, branchId, cashierId, "OPEN", foodCategoryId))
                .as("real OPA must ALLOW add_item for an unassigned, in-tenant, in-branch caller")
                .doesNotThrowAnyException();
    }

    // ── (1) THE POINT OF THE PROGRAM: the server refuses ──────────────────────────────────

    /**
     * A counter cashier assigned only the bar's categories rings a food item. The server must
     * REFUSE — not hide the button, refuse the write — and the check must be left with no line on
     * it.
     *
     * <p>This drives {@code orderService.addItem}, the real service method the endpoint calls, so it
     * fails if the guard is removed from that method OR if the rule is removed from the bundle. The
     * two are distinguished by {@link #waiterWithNoAssignmentRingsAnything}; see the class javadoc.
     */
    @Test
    void cashierScopedToDrinksIsRefusedAFoodItem() {
        scopedTo(drinksCategoryId);
        OrderDto check = newCheck();

        assertThatThrownBy(() -> orderService.addItem(
                check.id(), new AddOrderItemRequest(foodItemId, branchId, 1, null, null)))
                .as("a cashier confined to Drinks must not be able to ring a food item")
                .isInstanceOf(PermissionDeniedException.class)
                .hasMessageContaining("pos.order.add_item");

        // Nothing half-built survived the refusal. The guard runs before the first field of the
        // OrderItem is set, which is what makes this assertion meaningful rather than incidental.
        assertThat(orderService.getOrder(check.id(), branchId).items())
                .as("a refused add must leave no line on the check")
                .isEmpty();
    }

    /** ...and the same cashier rings a DRINK on the same check, in the same breath. */
    @Test
    void theSameCashierCanStillRingWhatTheyAreAssigned() {
        scopedTo(drinksCategoryId);
        OrderDto check = newCheck();

        orderService.addItem(check.id(), new AddOrderItemRequest(drinkItemId, branchId, 1, null, null));

        assertThat(orderService.getOrder(check.id(), branchId).items())
                .as("the refusal must be attributable to the CATEGORY and not to the scope existing")
                .hasSize(1);
    }

    /** A cashier assigned SEVERAL categories may ring all of them — the owner's "multiple menu". */
    @Test
    void aCashierAssignedTwoCategoriesRingsBoth() {
        scopedTo(drinksCategoryId, foodCategoryId);
        OrderDto check = newCheck();

        orderService.addItem(check.id(), new AddOrderItemRequest(drinkItemId, branchId, 1, null, null));
        orderService.addItem(check.id(), new AddOrderItemRequest(foodItemId, branchId, 1, null, null));

        assertThat(orderService.getOrder(check.id(), branchId).items()).hasSize(2);
    }

    // ── (2) THE DO-NOTHING DEFAULT: every existing user is unaffected ──────────────────────

    /**
     * The waiter. No assignment, no claim on the token, the whole menu.
     *
     * <p>This is the test that fails if the {@code pos.order.add_item} rules are deleted from the
     * bundle — {@code default allow := false} then refuses everyone, which on a till means the
     * restaurant stops taking orders. It is deliberately the LOUDEST failure in this file, because
     * it is the one that corresponds to a total outage rather than to a leak.
     */
    @Test
    void waiterWithNoAssignmentRingsAnything() {
        unrestricted();
        OrderDto check = newCheck();

        orderService.addItem(check.id(), new AddOrderItemRequest(drinkItemId, branchId, 1, null, null));
        orderService.addItem(check.id(), new AddOrderItemRequest(foodItemId, branchId, 1, null, null));

        assertThat(orderService.getOrder(check.id(), branchId).items()).hasSize(2);
    }

    /**
     * Every degenerate claim shape degrades to UNRESTRICTED, driven through the real service.
     *
     * <p>{@code pos_test.rego} pins each shape at the policy level. This pins the SAME shapes
     * through {@code PosAuthorizationService} and {@code DefaultOpaClient}, because the policy tests
     * hand-write the JSON and this path serialises it with production's Jackson mapper — a claim
     * that survives rego but is rendered differently on the wire would pass there and fail here.
     *
     * <p>Getting any one of these backwards is a POS outage, not a policy nit.
     */
    @Test
    void everyMalformedScopeClaimLeavesTheCallerUnrestricted() {
        List<Map<String, Object>> harmless = List.of(
                Map.of(),                                                 // no claim at all
                Map.of("approval_limit_paisa", 50_000L),                  // other claims only
                Map.of("menu_categories", List.of()),                     // present, empty
                Map.of("menu_categories", "not-a-list"),                  // present, wrong type
                Map.of("menu_categories", List.of(1, 2)));                // present, no strings

        for (Map<String, Object> attributes : harmless) {
            setSecurityContext(attributes);
            OrderDto check = newCheck();
            assertThatCode(() -> orderService.addItem(
                    check.id(), new AddOrderItemRequest(foodItemId, branchId, 1, null, null)))
                    .as("a token carrying %s must leave the caller able to ring the whole menu — "
                            + "reading it as an empty allow-list stops the till", attributes)
                    .doesNotThrowAnyException();
        }
    }

    /**
     * A list mixing one usable entry with junk is RESTRICTED, not unrestricted.
     *
     * <p>The permissive degrade is for tokens that say nothing usable at all. If one bad element
     * unlocked the whole menu, a single typo in the admin form would silently dissolve the boundary
     * — which is the failure this program exists to stop, arriving through the back door of the
     * fallback that protects against it.
     */
    @Test
    void aScopeWithOneUsableEntryStillBinds() {
        setSecurityContext(Map.of("menu_categories",
                List.of(drinksCategoryId.toString(), "not-a-uuid")));
        OrderDto check = newCheck();

        assertThatThrownBy(() -> orderService.addItem(
                check.id(), new AddOrderItemRequest(foodItemId, branchId, 1, null, null)))
                .isInstanceOf(PermissionDeniedException.class);

        // Control: the usable entry still works, so the refusal is the scope binding and not the
        // junk entry breaking the claim outright.
        orderService.addItem(check.id(), new AddOrderItemRequest(drinkItemId, branchId, 1, null, null));
        assertThat(orderService.getOrder(check.id(), branchId).items()).hasSize(1);
    }

    // ── (3) THE FILTER: the grid stops showing a button that would 403 ────────────────────

    /**
     * The grid narrows to the same scope — so a confined cashier is not shown a tile that refuses.
     *
     * <p>This is a FILTER and the boundary above is the boundary. Note the assertion shape: it waits
     * for the PERMITTED category to be present and fails if the forbidden one is, rather than
     * asserting absence alone. An absence-only assertion passes just as happily against a list that
     * came back empty because the query broke.
     */
    @Test
    void theGridShowsOnlyTheCategoriesTheOperatorMayRing() {
        scopedTo(drinksCategoryId);

        List<MenuCategoryDto> categories = menuService.listCategories();
        assertThat(categories).extracting(MenuCategoryDto::id)
                .as("the permitted category must be present — an empty list would satisfy an "
                        + "absence-only assertion while proving nothing")
                .contains(drinksCategoryId);
        assertThat(categories).extracting(MenuCategoryDto::id).doesNotContain(foodCategoryId);

        List<MenuItemDto> items = menuService.listItems(null, branchId, PageRequest.of(0, 50))
                .getContent();
        assertThat(items).extracting(MenuItemDto::id).contains(drinkItemId);
        assertThat(items).extracting(MenuItemDto::id).doesNotContain(foodItemId);
    }

    /** ...and an unassigned operator still sees the whole menu. */
    @Test
    void theGridIsUnchangedForAnOperatorWithNoAssignment() {
        unrestricted();

        assertThat(menuService.listCategories()).extracting(MenuCategoryDto::id)
                .contains(drinksCategoryId, foodCategoryId);
        assertThat(menuService.listItems(null, branchId, PageRequest.of(0, 50)).getContent())
                .extracting(MenuItemDto::id)
                .contains(drinkItemId, foodItemId);
    }

    /**
     * Asking for a forbidden category by id answers an EMPTY page, not a 403.
     *
     * <p>A read of a list is not an attempted violation, and a 403 here would also let a caller
     * enumerate which categories exist by which ones refuse rather than come back empty.
     */
    @Test
    void anExplicitlyRequestedForbiddenCategoryReturnsAnEmptyPage() {
        scopedTo(drinksCategoryId);

        assertThat(menuService.listItems(foodCategoryId, branchId, PageRequest.of(0, 50)).getContent())
                .isEmpty();
        assertThat(menuService.listItems(drinksCategoryId, branchId, PageRequest.of(0, 50)).getContent())
                .extracting(MenuItemDto::id)
                .as("the control: the permitted category still returns its items")
                .contains(drinkItemId);
    }

    /**
     * The single-item read is narrowed too — the hole an adversarial review of the first cut found.
     *
     * <p>{@code listCategories} and {@code listItems} were filtered and {@code getItem} was not, so
     * a cashier confined to Drinks could read a Mains item's name, price and branch override by
     * asking for it by id. Never a boundary breach — {@code cashierScopedToDrinksIsRefusedAFoodItem}
     * above proves the ring is still refused — but a filter that covers two of three read surfaces
     * is one a later reader assumes covers all three.
     *
     * <p>Both directions are asserted. A test that only proved the refusal would also pass against a
     * {@code getItem} that threw for everyone, which is a till with no item detail at all.
     */
    @Test
    void theSingleItemReadIsNarrowedByTheSameScopeAsTheGrid() {
        scopedTo(drinksCategoryId);

        assertThatThrownBy(() -> menuService.getItem(foodItemId, branchId))
                .as("an out-of-scope item is NOT FOUND for this operator — not forbidden, which "
                        + "would let them map the catalogue by which ids refuse")
                .isInstanceOf(ResourceNotFoundException.class);

        assertThat(menuService.getItem(drinkItemId, branchId).id())
                .as("the control: an item inside the scope still reads")
                .isEqualTo(drinkItemId);
    }

    /** The no-regression case: an unassigned operator — everyone, today — reads any item. */
    @Test
    void theSingleItemReadIsUnchangedForAnOperatorWithNoAssignment() {
        unrestricted();

        assertThat(menuService.getItem(foodItemId, branchId).id()).isEqualTo(foodItemId);
        assertThat(menuService.getItem(drinkItemId, branchId).id()).isEqualTo(drinkItemId);
    }

    // ── (4) the contract between two services, and between two controls ───────────────────

    /**
     * The claim key is a string shared by auth-service, {@code pos.rego} and this service. A rename
     * on one side does not throw — it silently hands every confined cashier the whole menu back. The
     * literal is asserted here, not the constant, because asserting the constant against itself
     * proves nothing.
     */
    @Test
    void theClaimSpellingIsTheContractBetweenTwoServices() {
        setSecurityContext(Map.of("menu_categories", List.of(drinksCategoryId.toString())));
        MenuCategoryScope scope = posAuthorizationService.resolveMenuCategoryScope();

        assertThat(scope.isUnrestricted())
                .as("the literal key 'menu_categories' — auth-service's "
                        + "PermissionResolver.MENU_CATEGORY_SCOPE_CLAIM — must be the one read here")
                .isFalse();
        assertThat(scope.permits(drinksCategoryId)).isTrue();
        assertThat(scope.permits(foodCategoryId)).isFalse();
    }

    /**
     * The boundary holds for a caller that never loaded the grid.
     *
     * <p>This is the whole reason the filter is not the control. The owner said hiding the tile was
     * not sufficient; this drives {@code authorizeAddItem} directly, with no list read first, and it
     * is the shape a client speaking to the endpoint by hand takes.
     */
    @Test
    void theRefusalDoesNotDependOnHavingReadTheGrid() {
        scopedTo(drinksCategoryId);

        assertThatThrownBy(() -> posAuthorizationService.authorizeAddItem(
                UUID.randomUUID(), tenantId, branchId, cashierId, "OPEN", foodCategoryId))
                .isInstanceOf(PermissionDeniedException.class);

        // Control: same call, permitted category — allowed. So the refusal is the category and not
        // some other clause of the rule failing.
        assertThatCode(() -> posAuthorizationService.authorizeAddItem(
                UUID.randomUUID(), tenantId, branchId, cashierId, "OPEN", drinksCategoryId))
                .doesNotThrowAnyException();
    }

    /**
     * A caller that cannot say what category it is ringing is refused when scoped.
     *
     * <p>Load-bearing for {@code authorization-service}, which exposes the same
     * {@code (pos, pos.order.add_item)} pair over HTTP and rebuilds the resource from an untrusted
     * body with a constructor that leaves {@code categoryId} null. Its attempts must deny; only
     * pos-service's own call, which reads the category off the resolved {@code MenuItem}, can allow.
     */
    @Test
    void aScopedCallerWithNoCategoryOnTheResourceIsRefused() {
        scopedTo(drinksCategoryId);

        assertThatThrownBy(() -> posAuthorizationService.authorizeAddItem(
                UUID.randomUUID(), tenantId, branchId, cashierId, "OPEN", null))
                .as("an absent category must deny rather than be waved through")
                .isInstanceOf(PermissionDeniedException.class);
    }
}
