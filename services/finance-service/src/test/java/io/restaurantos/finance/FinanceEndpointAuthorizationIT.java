package io.restaurantos.finance;

import io.restaurantos.finance.web.InternalFinanceController;
import io.restaurantos.finance.web.InternalProvisioningController;
import io.restaurantos.shared.feature.FeatureFlagService;
import io.restaurantos.shared.security.JwtClaims;
import io.restaurantos.shared.tenant.TenantContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.MethodSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.config.BeanDefinition;
import org.springframework.context.annotation.ClassPathScanningCandidateComponentProvider;
import org.springframework.core.annotation.AnnotatedElementUtils;
import org.springframework.core.type.filter.AnnotationTypeFilter;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors;
import org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.context.WebApplicationContext;

import java.lang.reflect.Method;
import java.lang.reflect.Modifier;
import java.util.List;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 10-18: ports PurchasingEndpointAuthorizationIT (10-09) to finance-service, which had NO such
 * guard before this plan. Proves every public finance endpoint (including the new AR routes)
 * is gated by a real {@code @PreAuthorize} check evaluated by the actual
 * {@code @EnableMethodSecurity} interceptor — not a mock.
 */
class FinanceEndpointAuthorizationIT extends FinanceTestBase {

    /** Internal, service-to-service controllers: no user principal, guarded by X-Internal-Service instead. */
    private static final Set<Class<?>> INTERNAL_ALLOWLIST = Set.of(
            InternalFinanceController.class, InternalProvisioningController.class);

    @Autowired
    private WebApplicationContext webApplicationContext;

    @Autowired
    private TenantContext tenantContext;

    @MockitoBean
    private FeatureFlagService featureFlagService;

    private MockMvc mockMvc;

    @BeforeEach
    void setUp() {
        mockMvc = MockMvcBuilders.webAppContextSetup(webApplicationContext)
                .apply(SecurityMockMvcConfigurers.springSecurity())
                .build();
        tenantContext.set(UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID(), null);
        when(featureFlagService.isEnabled(any(), any())).thenReturn(true);
    }

    private static org.springframework.test.web.servlet.request.RequestPostProcessor asUser(String... authorities) {
        List<GrantedAuthority> granted = List.of(authorities).stream()
                .<GrantedAuthority>map(SimpleGrantedAuthority::new)
                .toList();
        var authentication = new UsernamePasswordAuthenticationToken(
                new JwtClaims(UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID(),
                        List.of(), List.of(authorities), java.util.Map.of(), null),
                null, granted);
        return SecurityMockMvcRequestPostProcessors.authentication(authentication);
    }

    private static final String RANDOM_ID = "11111111-1111-1111-1111-111111111111";

    static List<org.junit.jupiter.params.provider.Arguments> arMutatingRoutes() {
        return List.of(
                args(HttpMethod.POST, "/api/v1/finance/ar/customer-accounts",
                        "{\"branchId\":\"" + RANDOM_ID + "\",\"accountCode\":\"HA-1\",\"name\":\"Acme\",\"creditLimitPaisa\":100000,\"paymentTermsDays\":30}"),
                args(HttpMethod.POST, "/api/v1/finance/ar/charges",
                        "{\"branchId\":\"" + RANDOM_ID + "\",\"customerAccountId\":\"" + RANDOM_ID + "\",\"txnDate\":\"2026-06-15\",\"amountPaisa\":10000}"),
                args(HttpMethod.POST, "/api/v1/finance/ar/settlements",
                        "{\"branchId\":\"" + RANDOM_ID + "\",\"customerAccountId\":\"" + RANDOM_ID + "\",\"txnDate\":\"2026-06-15\",\"amountPaisa\":10000}")
        );
    }

    private static org.junit.jupiter.params.provider.Arguments args(HttpMethod method, String url, String body) {
        return org.junit.jupiter.params.provider.Arguments.of(method, url, body);
    }

    /** Negative control: a user holding ONLY pos.order.create gets 403 on every AR mutating route. */
    @ParameterizedTest(name = "{0} {1} -> 403 for a POS-only user")
    @MethodSource("arMutatingRoutes")
    void posOnlyUser_isForbidden_onEveryArMutatingEndpoint(HttpMethod method, String url, String body) throws Exception {
        MockHttpServletRequestBuilder request = MockMvcRequestBuilders.request(method, url)
                .with(asUser("pos.order.create", "pos.order.view"))
                .contentType(MediaType.APPLICATION_JSON)
                .content(body);
        mockMvc.perform(request).andExpect(status().isForbidden());
    }

    /** A finance.ar.view-only user CAN read /aging, but is forbidden from POST /charges. */
    @Test
    void arViewOnlyUser_canReadAging_butForbiddenFromPostingCharges() throws Exception {
        mockMvc.perform(MockMvcRequestBuilders.get("/api/v1/finance/ar/aging")
                        .param("branchId", RANDOM_ID)
                        .with(asUser("finance.ar.view")))
                .andExpect(status().isOk());

        mockMvc.perform(MockMvcRequestBuilders.post("/api/v1/finance/ar/charges")
                        .with(asUser("finance.ar.view"))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"branchId\":\"" + RANDOM_ID + "\",\"customerAccountId\":\"" + RANDOM_ID
                                + "\",\"txnDate\":\"2026-06-15\",\"amountPaisa\":10000}"))
                .andExpect(status().isForbidden());
    }

    @Test
    void arManageUser_isAllowed_onCreateCustomerAccount() throws Exception {
        mockMvc.perform(MockMvcRequestBuilders.post("/api/v1/finance/ar/customer-accounts")
                        .with(asUser("finance.ar.manage"))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"branchId\":\"" + RANDOM_ID + "\",\"accountCode\":\"HA-2\",\"name\":\"Acme\",\"creditLimitPaisa\":100000,\"paymentTermsDays\":30}"))
                .andExpect(status().isOk());
    }

    @Test
    void everyPublicEndpointIsGated() throws ClassNotFoundException {
        ClassPathScanningCandidateComponentProvider scanner = new ClassPathScanningCandidateComponentProvider(false);
        scanner.addIncludeFilter(new AnnotationTypeFilter(RestController.class));
        Set<BeanDefinition> candidates = scanner.findCandidateComponents("io.restaurantos.finance.web");

        assertThat(candidates).isNotEmpty();

        for (BeanDefinition bd : candidates) {
            Class<?> controllerClass = Class.forName(bd.getBeanClassName());
            if (INTERNAL_ALLOWLIST.contains(controllerClass)) {
                continue;
            }
            for (Method method : controllerClass.getDeclaredMethods()) {
                if (!Modifier.isPublic(method.getModifiers())) {
                    continue;
                }
                RequestMapping mapping = AnnotatedElementUtils.findMergedAnnotation(method, RequestMapping.class);
                if (mapping == null) {
                    continue;
                }
                // Pre-existing gap found by this new guard (10-18): PeriodController.getCurrentPeriod()
                // is mapped to /internal/periods/current — a genuine internal, no-user-principal
                // service-to-service endpoint (guarded by FinanceInternalServiceFilter's
                // X-Internal-Service secret, same as InternalFinanceController/
                // InternalProvisioningController) that was declared inside a controller class that is
                // OTHERWISE public and RBAC-gated. @PreAuthorize would be wrong here — there is no
                // Authentication/authorities on an internal call. Skipping by PATH (not by allowlisting
                // the whole class) keeps every genuinely public method in PeriodController covered.
                boolean isInternalPath = mapping.path().length > 0
                        && java.util.Arrays.stream(mapping.path()).anyMatch(p -> p.startsWith("/internal"));
                if (isInternalPath) {
                    continue;
                }
                assertThat(method.isAnnotationPresent(PreAuthorize.class))
                        .as("%s.%s() is a public request-mapped handler with no @PreAuthorize — every new finance endpoint must carry an explicit permission requirement",
                                controllerClass.getSimpleName(), method.getName())
                        .isTrue();
            }
        }
    }
}
