package io.restaurantos.purchasing;

import io.restaurantos.purchasing.web.InternalPurchasingController;
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
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.context.WebApplicationContext;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

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
 * Gap closure (10-09): proves every public purchasing endpoint is gated by a real
 * {@code @PreAuthorize} check, evaluated by the actual Spring Security
 * {@code @EnableMethodSecurity} interceptor — NOT a mock. A Cashier (holding only
 * the real CASHIER grant set: pos.order.create / pos.order.view) must be rejected
 * (403) on every mutating purchasing route; a Manager or a vendor.view-only viewer
 * must be allowed exactly where the permission map says they should be.
 *
 * <p>The {@link Authentication} objects here are built with the same
 * {@link JwtClaims} principal + {@link SimpleGrantedAuthority} list that
 * {@code JwtAuthenticationFilter} builds in production (shared-lib), so this
 * exercises the identical authorities model — only the JWT/JWKS parsing step is
 * substituted with {@code SecurityMockMvcRequestPostProcessors.authentication(...)},
 * which still runs the full filter chain including the real
 * {@code @EnableMethodSecurity} / {@code MethodSecurityInterceptor}.
 *
 * <p>OPA policy behaviour (approval limits, distinct-approver, close_po rule) is a
 * SEPARATE gate covered by the OPA integration tests (10-08 plan); this class only
 * proves the RBAC gate. The two are independent and both must hold.
 */
class PurchasingEndpointAuthorizationIT extends PurchasingTestBase {

    /** Endpoints deliberately excluded from the every-endpoint-is-gated guard: service-to-service, no user principal. */
    private static final Set<Class<?>> INTERNAL_ALLOWLIST = Set.of(InternalPurchasingController.class);

    @Autowired
    private WebApplicationContext webApplicationContext;

    @Autowired
    private TenantContext tenantContext;

    private MockMvc mockMvc;

    @BeforeEach
    void setUp() {
        mockMvc = MockMvcBuilders.webAppContextSetup(webApplicationContext)
                .apply(SecurityMockMvcConfigurerNoop.springSecurity())
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

    static List<org.junit.jupiter.params.provider.Arguments> mutatingRoutes() {
        return List.of(
                args(HttpMethod.POST, "/api/v1/purchasing/vendors", "{\"name\":\"Fresh Foods\",\"paymentTerms\":\"NET30\"}"),
                args(HttpMethod.PUT, "/api/v1/purchasing/vendors/" + RANDOM_ID, "{\"name\":\"Fresh Foods\",\"paymentTerms\":\"NET30\"}"),
                args(HttpMethod.POST, "/api/v1/purchasing/purchase-orders",
                        "{\"vendorId\":\"" + RANDOM_ID + "\",\"branchId\":\"" + RANDOM_ID + "\",\"lines\":[{\"ingredientId\":\"" + RANDOM_ID + "\",\"qty\":1,\"uom\":\"kg\",\"unitPricePaisa\":100}]}"),
                args(HttpMethod.POST, "/api/v1/purchasing/purchase-orders/" + RANDOM_ID + "/submit", null),
                args(HttpMethod.POST, "/api/v1/purchasing/purchase-orders/" + RANDOM_ID + "/approve", null),
                args(HttpMethod.POST, "/api/v1/purchasing/purchase-orders/" + RANDOM_ID + "/reject", "{\"reason\":\"bad\"}"),
                args(HttpMethod.POST, "/api/v1/purchasing/purchase-orders/" + RANDOM_ID + "/send", null),
                args(HttpMethod.POST, "/api/v1/purchasing/purchase-orders/" + RANDOM_ID + "/close", null),
                args(HttpMethod.POST, "/api/v1/purchasing/purchase-orders/" + RANDOM_ID + "/mock-receive", "{\"lines\":[]}"),
                args(HttpMethod.POST, "/api/v1/purchasing/invoices", "{}"),
                args(HttpMethod.POST, "/api/v1/purchasing/invoices/" + RANDOM_ID + "/override-match", "{\"justification\":\"x\"}"),
                args(HttpMethod.POST, "/api/v1/purchasing/payments", "{}")
        );
    }

    private static org.junit.jupiter.params.provider.Arguments args(HttpMethod method, String url, String body) {
        return org.junit.jupiter.params.provider.Arguments.of(method, url, body);
    }

    @ParameterizedTest(name = "{0} {1} -> 403 for Cashier")
    @MethodSource("mutatingRoutes")
    void cashier_isForbidden_onEveryMutatingEndpoint(HttpMethod method, String url, String body) throws Exception {
        MockHttpServletRequestBuilder request = MockMvcRequestBuilders.request(method, url)
                .with(asUser("pos.order.create", "pos.order.view"))
                .contentType(MediaType.APPLICATION_JSON);
        if (body != null) {
            request = request.content(body);
        }
        mockMvc.perform(request).andExpect(status().isForbidden());
    }

    @Test
    void manager_isAllowed_onVendorCreate() throws Exception {
        mockMvc.perform(MockMvcRequestBuilders.post("/api/v1/purchasing/vendors")
                        .with(asUser("vendor.manage"))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"Fresh Foods\",\"paymentTerms\":\"NET30\"}"))
                .andExpect(status().isOk());
    }

    @Test
    void viewer_withVendorView_canListButNotCreate() throws Exception {
        mockMvc.perform(MockMvcRequestBuilders.get("/api/v1/purchasing/vendors")
                        .with(asUser("vendor.view")))
                .andExpect(status().isOk());

        mockMvc.perform(MockMvcRequestBuilders.post("/api/v1/purchasing/vendors")
                        .with(asUser("vendor.view"))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"Fresh Foods\",\"paymentTerms\":\"NET30\"}"))
                .andExpect(status().isForbidden());
    }

    @Test
    void everyPublicEndpointIsGated() throws ClassNotFoundException {
        ClassPathScanningCandidateComponentProvider scanner = new ClassPathScanningCandidateComponentProvider(false);
        scanner.addIncludeFilter(new AnnotationTypeFilter(RestController.class));
        Set<BeanDefinition> candidates = scanner.findCandidateComponents("io.restaurantos.purchasing.web");

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
                boolean isMapping = AnnotatedElementUtils.hasAnnotation(method, RequestMapping.class);
                if (!isMapping) {
                    continue;
                }
                assertThat(method.isAnnotationPresent(PreAuthorize.class))
                        .as("%s.%s() is a public request-mapped handler with no @PreAuthorize — every new purchasing endpoint must carry an explicit permission requirement",
                                controllerClass.getSimpleName(), method.getName())
                        .isTrue();
            }
        }
    }

    /** Thin indirection so the import of springSecurity() reads clearly at the call site above. */
    private static final class SecurityMockMvcConfigurerNoop {
        static org.springframework.test.web.servlet.setup.MockMvcConfigurer springSecurity() {
            return org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity();
        }
    }
}
