package io.restaurantos.pos.web;

import org.junit.jupiter.api.Test;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.lang.annotation.Annotation;
import java.lang.reflect.Method;
import java.util.ArrayList;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Every externally routable POS endpoint carries an authorization gate.
 *
 * <p>This exists because the catalog and the enforcement had drifted completely apart. The
 * permissions were defined, granted to roles, carried in the JWT and used to build the sidebar —
 * and then almost no POS endpoint checked them. A KITCHEN_STAFF account holding exactly
 * {@code pos.kds.view} and {@code pos.kds.update} could open a till, create an order, add items,
 * send them to the kitchen and take a cash payment. Nothing failed, no test went red, and the UI
 * looked correctly locked down the whole time, because the sidebar hides what the API does not.
 *
 * <p>A missing annotation is invisible in review — it is the absence of a line, in a file where
 * every neighbouring method looks the same. So it gets asserted instead.
 *
 * <p>Reflection over the controller classes rather than the Spring context: no application needs to
 * start, so this stays a fast unit test that runs on every build. Internal controllers under
 * {@code /internal} are excluded — they are reachable only via the service mesh and authenticate
 * with the internal-service header, never a user JWT.
 */
class ControllerAuthorizationClosureTest {

    private static final List<Class<?>> CONTROLLERS = List.of(
            OrderController.class,
            PaymentController.class,
            MenuController.class,
            TillController.class,
            StationController.class,
            TableController.class);

    private static final List<Class<? extends Annotation>> MAPPINGS = List.of(
            RequestMapping.class, GetMapping.class, PostMapping.class,
            PutMapping.class, PatchMapping.class, DeleteMapping.class);

    @Test
    void everyPublicEndpointDeclaresAnAuthorizationGate() {
        List<String> unguarded = new ArrayList<>();
        int inspected = 0;

        for (Class<?> controller : CONTROLLERS) {
            assertThat(controller.isAnnotationPresent(RestController.class))
                    .as("%s is listed here but is not a @RestController", controller.getSimpleName())
                    .isTrue();

            boolean classGate = controller.isAnnotationPresent(PreAuthorize.class);
            for (Method method : controller.getDeclaredMethods()) {
                if (!isEndpoint(method) || method.isSynthetic()) {
                    continue;
                }
                inspected++;
                if (!classGate && !method.isAnnotationPresent(PreAuthorize.class)) {
                    unguarded.add(controller.getSimpleName() + "#" + method.getName());
                }
            }
        }

        // Without this the test passes trivially if the mapping detection ever stops matching —
        // an empty "unguarded" list would then mean "found nothing to check", not "all is well".
        assertThat(inspected)
                .as("endpoints actually inspected; a low count means the mapping detection broke, "
                        + "not that POS shrank")
                .isGreaterThanOrEqualTo(45);

        assertThat(unguarded)
                .as("POS endpoints with no @PreAuthorize — any authenticated user, of any role, "
                        + "can call these. Add the gate naming the permission the catalog already "
                        + "defines for this action.")
                .isEmpty();
    }

    /** Guards against the list above silently going stale if a controller is added or renamed. */
    @Test
    void theControllerListCoversEveryControllerInThePackage() {
        assertThat(CONTROLLERS).hasSize(6);
        for (Class<?> controller : CONTROLLERS) {
            assertThat(controller.getPackageName()).isEqualTo(getClass().getPackageName());
        }
    }

    private static boolean isEndpoint(Method method) {
        return MAPPINGS.stream().anyMatch(method::isAnnotationPresent);
    }
}
