package io.restaurantos.hr;

import jakarta.validation.Valid;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.config.BeanDefinition;
import org.springframework.context.annotation.ClassPathScanningCandidateComponentProvider;
import org.springframework.core.type.filter.AnnotationTypeFilter;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

import java.lang.reflect.Method;
import java.lang.reflect.Parameter;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * No hr-service endpoint accepts an unvalidated request body, and no future one can.
 *
 * <h2>The hole this closes</h2>
 *
 * <p>{@code ShiftController} took four {@code @RequestBody} parameters and {@code LeaveController}
 * two, none of them annotated {@code @Valid}, and the internal ingest endpoint a seventh. Without
 * {@code @Valid}, Spring binds the body and calls the method — every constraint declared on those
 * DTOs was dead code. Adding a {@code @NotBlank} to a record and believing it was enforced is the
 * specific way this fails silently: the annotation is right there in the file, so review passes.
 *
 * <h2>Why a test and not just the six annotations</h2>
 *
 * <p>A missing {@code @Valid} is the absence of six characters on a line that otherwise looks
 * exactly like its neighbours. The annotations fix today's endpoints; this fixes every endpoint
 * added after this phase. That is the part that lasts.
 *
 * <p>The scan is over the PACKAGE, not a hand-maintained class list, for the same reason — a list
 * is another thing someone must remember to append to. A controller added tomorrow is inspected
 * automatically.
 *
 * <p>Reflection over class metadata, with no Spring context started, so this stays a fast unit
 * test that runs on every build rather than an integration test that runs when someone asks.
 */
class RequestBodyValidationClosureTest {

    /** Both packages: {@code internal} is device-authenticated, which makes it wider, not narrower. */
    private static final Set<String> CONTROLLER_PACKAGES = Set.of(
            "io.restaurantos.hr.controller",
            "io.restaurantos.hr.controller.internal");

    @Test
    void everyRequestBodyParameterIsBeanValidated() {
        List<String> unvalidated = new ArrayList<>();
        int inspected = 0;

        for (Class<?> controller : findRestControllers()) {
            for (Method method : controller.getDeclaredMethods()) {
                if (method.isSynthetic()) {
                    continue;
                }
                for (Parameter parameter : method.getParameters()) {
                    if (!parameter.isAnnotationPresent(RequestBody.class)) {
                        continue;
                    }
                    inspected++;
                    if (!parameter.isAnnotationPresent(Valid.class)) {
                        unvalidated.add("%s#%s(%s %s)".formatted(
                                controller.getSimpleName(), method.getName(),
                                parameter.getType().getSimpleName(), parameter.getName()));
                    }
                }
            }
        }

        // A closure test that silently found nothing is worse than no test: it reports green
        // forever while the thing it guards rots. Assert it actually looked at something first.
        assertThat(inspected)
                .as("the scan found no @RequestBody parameters at all — the package filter is wrong,"
                        + " so this test is passing without having checked anything")
                .isGreaterThanOrEqualTo(7);

        assertThat(unvalidated)
                .as("@RequestBody without @Valid: the DTO's constraints are never executed, so every"
                        + " @NotBlank / @NotNull on these bodies is dead code. Add @Valid to each.")
                .isEmpty();
    }

    private static List<Class<?>> findRestControllers() {
        var scanner = new ClassPathScanningCandidateComponentProvider(false);
        scanner.addIncludeFilter(new AnnotationTypeFilter(RestController.class));
        List<Class<?>> controllers = new ArrayList<>();
        for (String pkg : CONTROLLER_PACKAGES) {
            for (BeanDefinition definition : scanner.findCandidateComponents(pkg)) {
                try {
                    controllers.add(Class.forName(definition.getBeanClassName()));
                } catch (ClassNotFoundException e) {
                    throw new IllegalStateException("Scanned but could not load " + definition.getBeanClassName(), e);
                }
            }
        }
        assertThat(controllers)
                .as("no @RestController found under %s", CONTROLLER_PACKAGES)
                .isNotEmpty();
        return controllers;
    }
}
