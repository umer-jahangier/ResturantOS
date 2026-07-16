package io.restaurantos.nlq.config;

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
 * A SECOND DataSource, entirely separate from the Spring-managed Postgres one (which backs
 * {@code nlq_db}'s allowlist + audit log). ClickHouse is read-only here — reached ONLY as the
 * {@code nlq_readonly} user created by plan 12-02, NEVER any write-capable credential. If a
 * write-capable ClickHouse user string ever appears anywhere in this service, that is a defect.
 *
 * <p>Mirrors reporting-service's {@code ClickHouseConfig} (plan 12-03) — see that class's javadoc
 * for why the ClickHouse DataSource is deliberately constructed as a local, not a {@code @Bean}:
 * shared-lib's {@code TenantAwareDataSourcePostProcessor} wraps every {@code DataSource} BEAN in
 * {@code TenantAwareDataSource}, which issues a Postgres-only {@code set_config(...)} call on every
 * checkout. ClickHouse has no such function, so a bean-wrapped ClickHouse DataSource would break
 * every query. Keeping it out of the bean graph avoids the post-processor entirely.
 */
@Configuration
public class ClickHouseReadOnlyConfig {

    @Bean(name = "clickHouseReadOnlyJdbcTemplate")
    public JdbcTemplate clickHouseReadOnlyJdbcTemplate(
            @Value("${restaurantos.clickhouse.url}") String clickHouseUrl,
            @Value("${restaurantos.clickhouse.database}") String database,
            @Value("${restaurantos.clickhouse.readonly-user}") String readonlyUser,
            @Value("${restaurantos.clickhouse.readonly-password}") String readonlyPassword,
            @Value("${restaurantos.nlq.timeout-seconds:5}") int timeoutSeconds) throws SQLException {
        String hostAndPort = clickHouseUrl.replaceFirst("^https?://", "");
        String jdbcUrl = "jdbc:clickhouse://" + hostAndPort + "/" + database;
        Properties props = new Properties();
        props.setProperty("user", readonlyUser);
        if (readonlyPassword != null && !readonlyPassword.isBlank()) {
            props.setProperty("password", readonlyPassword);
        }
        // Intentionally a local, not a @Bean — see the class javadoc.
        DataSource clickHouseReadOnlyDataSource = new ClickHouseDataSource(jdbcUrl, props);
        JdbcTemplate template = new JdbcTemplate(clickHouseReadOnlyDataSource);
        // Belt-and-braces client-side ceiling on top of the server-side nlq_readonly_profile
        // (plan 12-02: max_execution_time = 5 MAX 5, CONST-bound so it cannot be raised from
        // either side) — the server-side profile is the authoritative gate; this just fails the
        // client faster and with a clearer JDBC-level signal.
        template.setQueryTimeout(timeoutSeconds);
        return template;
    }

    /**
     * The Postgres {@link JdbcTemplate} (backs {@code nlq_db}), redeclared explicitly.
     *
     * <p>Boot's {@code JdbcTemplateAutoConfiguration} is
     * {@code @ConditionalOnMissingBean(JdbcTemplate.class)}, so the mere existence of
     * {@code clickHouseReadOnlyJdbcTemplate} above makes it back off and never create the default
     * {@code jdbcTemplate} bean. Declared here against the single (auto-configured, and
     * post-processed into a tenant-aware) Postgres DataSource, and marked {@code @Primary} so an
     * unqualified {@code JdbcTemplate} injection resolves to Postgres, not ClickHouse.
     */
    @Bean(name = "jdbcTemplate")
    @Primary
    public JdbcTemplate jdbcTemplate(DataSource dataSource) {
        return new JdbcTemplate(dataSource);
    }
}
