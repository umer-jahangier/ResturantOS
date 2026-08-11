package io.restaurantos.user;

import io.restaurantos.shared.tenant.TenantContext;
import io.restaurantos.user.repository.BranchRepository;
import jakarta.persistence.EntityManager;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.web.client.RestClient;
import org.testcontainers.containers.GenericContainer;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.containers.RabbitMQContainer;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.utility.DockerImageName;

import java.nio.charset.StandardCharsets;
import java.util.UUID;

@SpringBootTest(
    classes = UserServiceApplication.class,
    webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT
)
@Testcontainers
public abstract class BaseUserIT {

    /**
     * The container user is a SUPERUSER — that is not configurable, it is what the postgres image
     * creates from POSTGRES_USER. Naming it {@code user_service} (as this class used to) does not
     * make it unprivileged; it makes a superuser called user_service, and PostgreSQL exempts
     * superusers from row level security unconditionally, FORCE included. Every cross-tenant
     * assertion in this module was therefore being made against a connection for which tenant
     * isolation was switched off, and would have passed with the policies dropped entirely.
     *
     * <p>So the container user stays the bootstrap/owner role and {@code db/init-test-db.sql}
     * creates the real one: {@code user_service}, NOSUPERUSER NOBYPASSRLS, which both Liquibase
     * and the application connect as — the production topology from deploy/init/02-create-roles.sql.
     *
     * <p>That script is run by {@link #provisionAppRole()} after {@link #awaitPostgresReady()},
     * NOT by {@code withInitScript}. Testcontainers runs an init script during container start
     * with a single connection attempt and no retry, and the first connection to a freshly
     * started container on this Docker setup intermittently dies mid-handshake
     * ({@code EOFException} in {@code enableSSL} or {@code doAuthentication}). As an init script
     * that is a hard container-start failure and every test in the module errors on class init;
     * behind the existing retry loop it is a non-event.
     *
     * @see #APP_USER
     */
    static final PostgreSQLContainer<?> POSTGRES =
        new PostgreSQLContainer<>(DockerImageName.parse("postgres:18"))
            .withDatabaseName("user_db")
            .withUsername("test_owner")
            .withPassword("test-owner-pass")
            .withUrlParam("sslmode", "disable")
            .withUrlParam("tcpKeepAlive", "true");

    /** The unprivileged role the application and Liquibase connect as. RLS applies to it. */
    protected static final String APP_USER = "user_service";
    protected static final String APP_PASSWORD = "test-pass";

    @SuppressWarnings("resource")
    static final GenericContainer<?> REDIS =
        new GenericContainer<>(DockerImageName.parse("redis:8"))
            .withExposedPorts(6379);

    static final RabbitMQContainer RABBIT =
        new RabbitMQContainer(DockerImageName.parse("rabbitmq:4.3-management"));

    static {
        POSTGRES.start();
        REDIS.start();
        RABBIT.start();
        awaitPostgresReady();
        provisionAppRole();
    }

    /**
     * Creates the unprivileged {@link #APP_USER} role. The whole file goes to the server as one
     * simple-query batch — PostgreSQL accepts semicolon-separated statements that way, which
     * keeps the {@code DO $$ ... $$} block intact instead of being split on its inner semicolons.
     */
    private static void provisionAppRole() {
        String sql;
        try (java.io.InputStream in =
                 BaseUserIT.class.getResourceAsStream("/db/init-test-db.sql")) {
            if (in == null) {
                throw new IllegalStateException("db/init-test-db.sql missing from the test classpath");
            }
            sql = new String(in.readAllBytes(), StandardCharsets.UTF_8);
        } catch (java.io.IOException e) {
            throw new IllegalStateException(e);
        }
        try (java.sql.Connection c = asOwner(); java.sql.Statement s = c.createStatement()) {
            s.execute(sql);
        } catch (java.sql.SQLException e) {
            throw new IllegalStateException("Could not create the unprivileged test role", e);
        }
    }

    private static void awaitPostgresReady() {
        String url = jdbcUrl();
        RuntimeException last = null;
        for (int i = 0; i < 60; i++) {
            try (java.sql.Connection c =
                     java.sql.DriverManager.getConnection(url, POSTGRES.getUsername(), POSTGRES.getPassword());
                 java.sql.Statement s = c.createStatement()) {
                s.execute("SELECT 1");
                return;
            } catch (Exception e) {
                last = new IllegalStateException("Postgres not reachable: " + e.getMessage(), e);
                try { Thread.sleep(500); } catch (InterruptedException ie) {
                    Thread.currentThread().interrupt();
                    throw new IllegalStateException(ie);
                }
            }
        }
        throw last;
    }

    private static String jdbcUrl() {
        return POSTGRES.getJdbcUrl();
    }

    /**
     * A connection as the container's superuser, for fixture setup that has to reach past RLS
     * (seeding another tenant's rows so a leak has something to leak). Test code that is
     * ASSERTING isolation must never use this — use the application's own connection, which is
     * {@link #APP_USER} and subject to every policy.
     */
    protected static java.sql.Connection asOwner() throws java.sql.SQLException {
        return java.sql.DriverManager.getConnection(
            jdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword());
    }

    @DynamicPropertySource
    static void props(DynamicPropertyRegistry r) {
        // Bind the test server to loopback. Spring Boot otherwise binds the wildcard address,
        // and the macOS Application Firewall filters wildcard-bound sockets: it accepts the
        // connection, writes zero bytes and closes, so requests fail with "header parser received
        // no bytes" / PrematureCloseException and NOTHING is logged server-side. Intermittent, and
        // it looks exactly like an application or network bug. See DEV-STACK-RUNBOOK.md.
        r.add("server.address", () -> "127.0.0.1");
        r.add("spring.datasource.url", BaseUserIT::jdbcUrl);
        // NOT POSTGRES.getUsername() — that is the superuser, and RLS does not apply to it.
        r.add("spring.datasource.username", () -> APP_USER);
        r.add("spring.datasource.password", () -> APP_PASSWORD);
        r.add("spring.jpa.hibernate.ddl-auto", () -> "none");
        r.add("spring.liquibase.change-log", () -> "classpath:db/changelog/db.changelog-master.xml");
        r.add("spring.liquibase.contexts", () -> "");
        r.add("spring.data.redis.host", REDIS::getHost);
        r.add("spring.data.redis.port", () -> REDIS.getMappedPort(6379).toString());
        r.add("spring.rabbitmq.host", RABBIT::getHost);
        r.add("spring.rabbitmq.port", () -> String.valueOf(RABBIT.getAmqpPort()));
        r.add("spring.rabbitmq.username", RABBIT::getAdminUsername);
        r.add("spring.rabbitmq.password", RABBIT::getAdminPassword);
        r.add("eureka.client.enabled", () -> "false");
        // JWKS and auth-service default to a dead port: an IT that does not stand something up on
        // purpose must not silently reach a real one.
        r.add("restaurantos.jwks.uri", () -> jwksUri);
        r.add("restaurantos.internal.secret", () -> "test-internal-secret");
        r.add("restaurantos.auth-service.uri", () -> authServiceUri);
    }

    /**
     * The two upstream URIs a subclass may point at its own stub, by assigning in a {@code static}
     * block before the context is built.
     *
     * <p>They are mutable statics rather than a second {@code @DynamicPropertySource} in the
     * subclass because <b>the ordering of those is not something to rely on</b>: Spring collects
     * the methods by walking the class hierarchy, and a subclass registration for the same key can
     * be overwritten by this class's. That produced 17 failing tests reporting 401 — the token was
     * fine and the JWKS lookup was going to the dead port. The suppliers here are evaluated lazily
     * at context refresh, so whatever a subclass assigned is what the context sees, with no
     * ordering question at all.
     */
    protected static volatile String jwksUri = "http://localhost:9999/test-jwks-placeholder";
    protected static volatile String authServiceUri = "http://localhost:9999";

    @LocalServerPort protected int port;
    @Autowired protected TenantContext tenantContext;
    @Autowired protected BranchRepository branchRepository;
    @Autowired protected EntityManager entityManager;

    protected RestClient rest;

    /** Tenant A for primary test data */
    protected static final UUID TENANT_A = UUID.fromString("aa000001-0000-4000-8000-000000000001");
    /** Tenant B for cross-tenant isolation assertions */
    protected static final UUID TENANT_B = UUID.fromString("bb000001-0000-4000-8000-000000000002");

    @BeforeEach
    void setUp() {
        rest = RestClient.builder()
            .requestFactory(new org.springframework.http.client.JdkClientHttpRequestFactory())
            .baseUrl("http://127.0.0.1:" + port)
            .build();
        setRls(TENANT_A);
        tenantContext.set(TENANT_A, null, null, null);
    }

    @AfterEach
    void tearDown() {
        tenantContext.clear();
    }

    protected void setRls(UUID tenantId) {
        entityManager.createNativeQuery("SELECT set_config('app.current_tenant_id', :tid, false)")
            .setParameter("tid", tenantId.toString())
            .getSingleResult();
    }

    protected ResponseEntity<String> post(String uri, Object body) {
        return rest.post().uri(uri)
            .contentType(MediaType.APPLICATION_JSON)
            .body(body)
            .exchange((req, res) -> toEntity(res), false);
    }

    protected ResponseEntity<String> postWithHeader(String uri, Object body, String name, String value) {
        return rest.post().uri(uri)
            .contentType(MediaType.APPLICATION_JSON)
            .header(name, value)
            .body(body)
            .exchange((req, res) -> toEntity(res), false);
    }

    protected ResponseEntity<String> get(String uri) {
        return rest.get().uri(uri)
            .exchange((req, res) -> toEntity(res), false);
    }

    protected ResponseEntity<String> getWithHeader(String uri, String name, String value) {
        return rest.get().uri(uri)
            .header(name, value)
            .exchange((req, res) -> toEntity(res), false);
    }

    protected ResponseEntity<String> deleteWithHeader(String uri, String name, String value) {
        return rest.delete().uri(uri)
            .header(name, value)
            .exchange((req, res) -> toEntity(res), false);
    }

    protected static ResponseEntity<String> toEntity(org.springframework.http.client.ClientHttpResponse res)
            throws java.io.IOException {
        byte[] bytes = res.getBody() != null ? res.getBody().readAllBytes() : new byte[0];
        return ResponseEntity.status(res.getStatusCode())
            .headers(res.getHeaders())
            .body(new String(bytes, StandardCharsets.UTF_8));
    }
}
