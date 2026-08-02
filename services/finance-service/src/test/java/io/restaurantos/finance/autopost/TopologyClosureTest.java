package io.restaurantos.finance.autopost;

import io.restaurantos.finance.config.FinanceRabbitConfig;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.amqp.rabbit.annotation.RabbitListener;

import java.io.IOException;
import java.lang.reflect.Method;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Stream;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Every queue this service declares has a live listener, and every listener has a declared queue.
 *
 * <p><b>Why.</b> Three separate production defects were all the same shape — a declared binding
 * with nothing on the other end:
 *
 * <ul>
 *   <li>{@code finance.stock-received.queue} was declared and bound and had NO consumer, so every
 *       stock receipt piled up on a durable queue nobody drained.</li>
 *   <li>{@code finance.wastage.queue} had a consumer and no producer anywhere in the fleet.</li>
 *   <li>purchasing-service published {@code STOCK_RECEIVED} onto inventory's exchange, where
 *       nothing consumed it, so goods received against a purchase order never became stock.</li>
 * </ul>
 *
 * <p>None of them raised an error; each was found only by reading the broker. A plain unit test
 * over the declared topology and the annotated listeners closes the loop at build time, with no
 * container and no broker.
 */
class TopologyClosureTest {

    private static final Path CONSUMER_DIR =
            Path.of("src/main/java/io/restaurantos/finance/autopost/consumer");

    @Test
    @DisplayName("every declared queue has a @RabbitListener")
    void everyDeclaredQueueIsConsumed() throws Exception {
        Set<String> listening = listenerQueueNames();

        assertThat(listening)
                .as("queues declared in FinanceRabbitConfig with no listener — messages would "
                        + "accumulate on a durable queue forever")
                .containsAll(FinanceRabbitConfig.consumedQueues());
    }

    @Test
    @DisplayName("every @RabbitListener queue is declared")
    void everyListenerHasADeclaredQueue() throws Exception {
        assertThat(FinanceRabbitConfig.consumedQueues())
                .as("a listener whose queue this service never declares only works on a broker "
                        + "someone else provisioned — which is exactly how finance-service used to "
                        + "start healthy with no listeners attached")
                .containsAll(listenerQueueNames());
    }

    /**
     * Reads the queue name off each consumer's {@code @RabbitListener}. Resolved by reflection on
     * the compiled classes rather than by parsing source, so an annotation whose constant moved
     * still resolves to its real value.
     */
    private Set<String> listenerQueueNames() throws Exception {
        Set<String> names = new LinkedHashSet<>();
        for (Class<?> consumer : consumerClasses()) {
            for (Method m : consumer.getDeclaredMethods()) {
                RabbitListener annotation = m.getAnnotation(RabbitListener.class);
                if (annotation != null) {
                    names.addAll(List.of(annotation.queues()));
                }
            }
        }
        assertThat(names).as("no @RabbitListener found — this test would pass vacuously").isNotEmpty();
        return names;
    }

    private List<Class<?>> consumerClasses() throws IOException, ClassNotFoundException {
        List<Class<?>> classes = new ArrayList<>();
        try (Stream<Path> files = Files.list(CONSUMER_DIR)) {
            for (Path f : files.toList()) {
                Matcher m = Pattern.compile("(\\w+)\\.java$").matcher(f.getFileName().toString());
                if (m.find()) {
                    classes.add(Class.forName(
                            "io.restaurantos.finance.autopost.consumer." + m.group(1)));
                }
            }
        }
        return classes;
    }
}
