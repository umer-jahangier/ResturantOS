package io.restaurantos.audit;

import io.restaurantos.audit.entity.AuditEventEntity;
import io.restaurantos.audit.repository.AuditEventRepository;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.utility.DockerImageName;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.SQLException;
import java.time.Instant;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * Verifies the two-layer immutability enforcement on audit_events:
 *   1. Postgres trigger (prevent_audit_mutation) raises exception on UPDATE/DELETE for ANY user.
 *   2. INSERT-only privilege grant: audit_writer cannot UPDATE/DELETE.
 *
 * Note [03-01-D]: TESTCONTAINERS_RYUK_DISABLED=true may be required in Colima environments.
 * Note [03-03-B]: The privilege assertions use a non-superuser `audit_writer` role created in @BeforeAll.
 */
@SpringBootTest(
        classes = AuditServiceApplication.class,
        webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT
)
@Testcontainers
class AuditImmutabilityIT {

    @Container
    static final PostgreSQLContainer<?> POSTGRES =
            new PostgreSQLContainer<>(DockerImageName.parse("postgres:16"))
                    .withDatabaseName("audit_db")
                    .withUsername("audit_admin")
                    .withPassword("test-pass");

    @DynamicPropertySource
    static void props(DynamicPropertyRegistry r) {
        r.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        r.add("spring.datasource.username", POSTGRES::getUsername);
        r.add("spring.datasource.password", POSTGRES::getPassword);
        r.add("spring.liquibase.url", POSTGRES::getJdbcUrl);
        r.add("spring.liquibase.user", POSTGRES::getUsername);
        r.add("spring.liquibase.password", POSTGRES::getPassword);
        r.add("spring.jpa.hibernate.ddl-auto", () -> "none");
        r.add("eureka.client.enabled", () -> "false");
        r.add("spring.rabbitmq.host", () -> "localhost");
        r.add("spring.rabbitmq.port", () -> "5672");
        r.add("spring.rabbitmq.username", () -> "guest");
        r.add("spring.rabbitmq.password", () -> "guest");
        r.add("TESTCONTAINERS_RYUK_DISABLED", () -> "true");
    }

    @BeforeAll
    static void createAuditWriterRole() throws Exception {
        // Create a non-superuser audit_writer role so privilege assertions are meaningful [03-03-B]
        try (Connection conn = DriverManager.getConnection(
                POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword())) {
            try (var stmt = conn.createStatement()) {
                stmt.execute("DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'audit_writer') THEN CREATE ROLE audit_writer LOGIN PASSWORD 'audit_writer_pass'; END IF; END $$");
            }
        }
    }

    @Autowired
    private AuditEventRepository auditEventRepository;

    @Autowired
    private JdbcTemplate jdbcTemplate;

    // ---- INSERT ----

    @Test
    void insert_auditEvent_succeeds() {
        Instant now = Instant.now();
        AuditEventEntity entity = AuditEventEntity.builder()
                .occurredAt(now)
                .tenantId(UUID.randomUUID())
                .action("USER_LOGIN_SUCCEEDED")
                .build();

        AuditEventEntity saved = auditEventRepository.saveAndFlush(entity);
        assertThat(saved.getId()).isNotNull();
        assertThat(saved.getAction()).isEqualTo("USER_LOGIN_SUCCEEDED");
    }

    // ---- TRIGGER: UPDATE blocked ----

    @Test
    void update_auditEvent_raisesException_withAppendOnlyMessage() {
        Instant now = Instant.now();
        AuditEventEntity entity = AuditEventEntity.builder()
                .occurredAt(now)
                .tenantId(UUID.randomUUID())
                .action("INITIAL_ACTION")
                .build();
        AuditEventEntity saved = auditEventRepository.saveAndFlush(entity);
        Long id = saved.getId();

        assertThatThrownBy(() ->
                jdbcTemplate.update(
                        "UPDATE audit_events SET action = 'hacked' WHERE id = ?", id))
                .isInstanceOf(org.springframework.dao.DataAccessException.class)
                .hasMessageContaining("append-only");
    }

    // ---- TRIGGER: DELETE blocked ----

    @Test
    void delete_auditEvent_raisesException_withAppendOnlyMessage() {
        Instant now = Instant.now();
        AuditEventEntity entity = AuditEventEntity.builder()
                .occurredAt(now)
                .tenantId(UUID.randomUUID())
                .action("TO_BE_DELETED")
                .build();
        AuditEventEntity saved = auditEventRepository.saveAndFlush(entity);
        Long id = saved.getId();

        assertThatThrownBy(() ->
                jdbcTemplate.update(
                        "DELETE FROM audit_events WHERE id = ?", id))
                .isInstanceOf(org.springframework.dao.DataAccessException.class)
                .hasMessageContaining("append-only");
    }

    // ---- GRANT: audit_writer has INSERT-only, no UPDATE/DELETE ----

    @Test
    void auditWriter_hasInsertPrivilege() {
        Boolean hasInsert = jdbcTemplate.queryForObject(
                "SELECT has_table_privilege('audit_writer', 'audit_events', 'INSERT')",
                Boolean.class);
        assertThat(hasInsert).isTrue();
    }

    @Test
    void auditWriter_hasNoUpdatePrivilege() {
        Boolean hasUpdate = jdbcTemplate.queryForObject(
                "SELECT has_table_privilege('audit_writer', 'audit_events', 'UPDATE')",
                Boolean.class);
        assertThat(hasUpdate).isFalse();
    }

    @Test
    void auditWriter_hasNoDeletePrivilege() {
        Boolean hasDelete = jdbcTemplate.queryForObject(
                "SELECT has_table_privilege('audit_writer', 'audit_events', 'DELETE')",
                Boolean.class);
        assertThat(hasDelete).isFalse();
    }
}
