package io.restaurantos.audit;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.restaurantos.audit.config.AuditRabbitConfig;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.io.File;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Keeps {@code AuditRabbitConfig} and {@code deploy/init/rabbitmq-definitions.json} in agreement.
 *
 * <h3>Why this test exists</h3>
 *
 * <p>The audit trail is now declared in TWO places: in code, so a service that comes up against a
 * reset broker heals itself, and in the definitions file, which provisions compose and seeds the
 * k8s bootstrap Job. Two sources of truth for one topology is a drift hazard, and the drift is
 * SILENT in the worst possible direction — add a tenth topic exchange to the definitions file and
 * forget the code, and audit-service keeps starting, keeps reporting UP, and simply stops recording
 * that exchange's events. Nothing fails. The trail just quietly becomes incomplete.
 *
 * <p>This is the cheapest possible guard against that: compare the two lists.
 *
 * <p>The alternative — deleting the definitions file entry — is worse. Compose still relies on it,
 * and it remains the readable statement of intended topology for a human.
 */
class AuditTopologyMatchesDefinitionsTest {

    private static JsonNode definitions;

    @BeforeAll
    static void loadDefinitions() throws Exception {
        // Walk up from the module dir to the repo root, so this works whether the suite is run
        // from services/audit-service or from the reactor root.
        File probe = new File("deploy/init/rabbitmq-definitions.json");
        if (!probe.exists()) {
            probe = new File("../../deploy/init/rabbitmq-definitions.json");
        }
        assertThat(probe)
                .as("rabbitmq-definitions.json must be findable from the module or the reactor root")
                .exists();
        definitions = new ObjectMapper().readTree(probe);
    }

    private static Set<String> exchangesBoundToAuditQueueInDefinitions() {
        Set<String> sources = new LinkedHashSet<>();
        for (JsonNode b : definitions.withArray("bindings")) {
            if (AuditRabbitConfig.ALL_EVENTS_QUEUE.equals(b.path("destination").asText())) {
                sources.add(b.path("source").asText());
            }
        }
        return sources;
    }

    @SuppressWarnings("unchecked")
    private static List<String> configuredExchanges() throws Exception {
        var f = AuditRabbitConfig.class.getDeclaredField("AUDITED_TOPIC_EXCHANGES");
        f.setAccessible(true);
        return new ArrayList<>((List<String>) f.get(null));
    }

    @Test
    @DisplayName("the code's audited exchange list matches the definitions file exactly")
    void codeAndDefinitionsAgree() throws Exception {
        Set<String> fromFile = exchangesBoundToAuditQueueInDefinitions();
        List<String> fromCode = configuredExchanges();

        assertThat(fromFile)
                .as("definitions.json must bind the audit queue to at least one exchange")
                .isNotEmpty();
        // Order-independent: the two files are maintained by different hands.
        assertThat(fromCode)
                .as("AuditRabbitConfig.AUDITED_TOPIC_EXCHANGES vs rabbitmq-definitions.json bindings")
                .containsExactlyInAnyOrderElementsOf(fromFile);
    }

    @Test
    @DisplayName("the queue and its DLQ are both declared in the definitions file")
    void queueAndDlqDeclared() {
        Set<String> names = new LinkedHashSet<>();
        for (JsonNode q : definitions.withArray("queues")) {
            names.add(q.path("name").asText());
        }
        assertThat(names).contains(
                AuditRabbitConfig.ALL_EVENTS_QUEUE,
                AuditRabbitConfig.ALL_EVENTS_QUEUE + ".dlq");
    }

    @Test
    @DisplayName("dead-letter arguments match, or the durable queue is rejected with 406 at startup")
    void deadLetterArgumentsMatch() {
        JsonNode auditQueue = null;
        for (JsonNode q : definitions.withArray("queues")) {
            if (AuditRabbitConfig.ALL_EVENTS_QUEUE.equals(q.path("name").asText())) {
                auditQueue = q;
            }
        }
        assertThat(auditQueue).as("audit queue present in definitions").isNotNull();

        // RabbitMQ does not reconfigure an existing durable queue: a declaration whose arguments
        // differ is refused with PRECONDITION_FAILED, which kills startup exactly as the missing
        // queue did. These two spellings must stay byte-identical.
        assertThat(auditQueue.path("arguments").path("x-dead-letter-exchange").asText())
                .isEqualTo(AuditRabbitConfig.DLX);
        assertThat(auditQueue.path("arguments").path("x-dead-letter-routing-key").asText())
                .isEqualTo(AuditRabbitConfig.ALL_EVENTS_QUEUE + ".dlq");
    }
}
