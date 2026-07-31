package io.restaurantos.reporting.config;

import com.clickhouse.jdbc.ClickHouseDataSource;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Primary;
import org.springframework.jdbc.core.JdbcTemplate;

import javax.sql.DataSource;
import java.sql.SQLException;
import java.util.Properties;

/**
 * A SECOND DataSource, entirely separate from the Spring-managed Postgres one. ClickHouse is a
 * write target for the ETL (this plan) and a read target for reports/dashboard/NLQ (12-05, 12-06,
 * 12-07) — always accessed via raw SQL through {@link JdbcTemplate}, never JPA (ClickHouse is not
 * a JPA-friendly OLTP store).
 *
 * <p><b>CRITICAL:</b> this bean must NOT be wrapped in, subclass, or reimplement shared-lib's
 * tenant-aware Postgres {@code DataSource} decorator (package {@code io.restaurantos.shared.tenant}).
 * That class carries the RLS tenant GUC on the POSTGRES connection (commit 2099ac0 fixed a subtle
 * bug where the GUC was
 * set transaction-locally at pool checkout and discarded before BEGIN, making every
 * {@code @Transactional} write tenant-blind). ClickHouse has no RLS and no transactions — tenant
 * isolation there is enforced purely by explicit {@code WHERE tenant_id = ?} predicates in every
 * query issued by the writers/readers. reporting-service inherits the Postgres fix for free by
 * depending on the current shared-lib; it must never be extended to cover ClickHouse.
 *
 * <p><b>Why the ClickHouse DataSource is deliberately NOT a bean.</b> shared-lib's
 * {@code TenantAwareDataSourcePostProcessor} wraps EVERY {@code DataSource} <i>bean</i> in the
 * context — its test is a bare {@code bean instanceof DataSource}, with no bean-name or
 * target-database discrimination. A {@code @Bean} ClickHouse DataSource would therefore be wrapped
 * in {@link io.restaurantos.shared.tenant.TenantAwareDataSource} too, which issues
 * {@code SELECT set_config('app.current_tenant_id', ?, false)} on every checkout where a tenant is
 * in context. That is a POSTGRES-ONLY function; ClickHouse has no such function, and the ETL always
 * runs with a tenant in context (it is read off the event envelope), so every ClickHouse write
 * would fail. Constructing the DataSource inside this factory method keeps it out of the bean
 * graph, so the post-processor never sees it — the "must not be wrapped" rule above is thereby
 * enforced structurally rather than by comment.
 *
 * <p>Because no second {@code DataSource} bean exists, Spring Boot's own DataSource
 * auto-configuration is unambiguous and configures the Postgres one normally from
 * {@code spring.datasource.*} — and that bean IS post-processed, so reporting-service still
 * inherits the RLS tenant-GUC fix (commit 2099ac0) for free.
 */
@Configuration
public class ClickHouseConfig {

    @Bean(name = "clickHouseJdbcTemplate")
    public JdbcTemplate clickHouseJdbcTemplate(
            @Value("${restaurantos.clickhouse.url}") String clickHouseUrl,
            @Value("${restaurantos.clickhouse.database}") String database,
            @Value("${restaurantos.clickhouse.user}") String user,
            @Value("${restaurantos.clickhouse.password}") String password) throws SQLException {
        // restaurantos.clickhouse.url is the HTTP-interface base URL (e.g.
        // "http://localhost:8123", shared with deploy/clickhouse/apply.sh's curl calls). The
        // clickhouse-jdbc driver's canonical URL form is "jdbc:clickhouse://host:port/database"
        // (confirmed against org.testcontainers.clickhouse.ClickHouseContainer#getJdbcUrl, which
        // EtlPipelineIT asserts against a real container) — strip the http(s):// scheme and
        // re-prefix with jdbc:clickhouse://.
        String hostAndPort = clickHouseUrl.replaceFirst("^https?://", "");
        String jdbcUrl = "jdbc:clickhouse://" + hostAndPort + "/" + database;
        Properties props = new Properties();
        props.setProperty("user", user);
        if (password != null && !password.isBlank()) {
            props.setProperty("password", password);
        }
        // Intentionally a local, not a @Bean — see the class javadoc.
        DataSource clickHouseDataSource = new ClickHouseDataSource(jdbcUrl, props);
        return new JdbcTemplate(clickHouseDataSource);
    }

    /**
     * The Postgres {@link JdbcTemplate}, redeclared explicitly.
     *
     * <p>Boot's {@code JdbcTemplateAutoConfiguration} is
     * {@code @ConditionalOnMissingBean(JdbcTemplate.class)}, so the mere existence of
     * {@code clickHouseJdbcTemplate} above makes it back off and never create the default
     * {@code jdbcTemplate} bean — leaving Postgres-side JDBC access with no template at all. It is
     * therefore declared here, against the single (auto-configured, and post-processed into a
     * tenant-aware) Postgres DataSource, and marked {@code @Primary} so an unqualified
     * {@code JdbcTemplate} injection resolves to Postgres rather than ambiguously to ClickHouse.
     */
    @Bean(name = "jdbcTemplate")
    @Primary
    public JdbcTemplate jdbcTemplate(DataSource dataSource) {
        return new JdbcTemplate(dataSource);
    }
}
