package io.restaurantos.reporting.config;

import com.clickhouse.jdbc.ClickHouseDataSource;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.jdbc.DataSourceBuilder;
import org.springframework.boot.context.properties.ConfigurationProperties;
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
 * <p>Spring Boot's DataSource auto-configuration only tolerates a SINGLE unqualified DataSource
 * bean being wired implicitly into JPA/Hibernate. With two DataSource beans in this context (this
 * one plus the ClickHouse one below) that auto-configuration is ambiguous, so the Postgres
 * DataSource is redeclared explicitly here and marked {@code @Primary} — standard Spring Boot
 * "multiple DataSources" pattern (docs: "Configure a primary DataSource"). This does not change
 * Postgres connectivity or pooling; {@code @ConfigurationProperties(prefix = "spring.datasource")}
 * binds the exact same {@code spring.datasource.*} properties Boot's own auto-configuration would
 * have used, and {@code DataSourceBuilder} picks the same HikariCP implementation already on the
 * classpath via spring-boot-starter-data-jpa.
 */
@Configuration
public class ClickHouseConfig {

    @Bean
    @Primary
    @ConfigurationProperties(prefix = "spring.datasource")
    public DataSource dataSource() {
        return DataSourceBuilder.create().build();
    }

    @Bean(name = "clickHouseDataSource")
    public DataSource clickHouseDataSource(
            @Value("${restaurantos.clickhouse.url}") String clickHouseUrl,
            @Value("${restaurantos.clickhouse.database}") String database,
            @Value("${restaurantos.clickhouse.user}") String user,
            @Value("${restaurantos.clickhouse.password}") String password) throws SQLException {
        // clickhouse-jdbc accepts the HTTP-interface base URL directly after the "jdbc:clickhouse:"
        // scheme prefix (e.g. "jdbc:clickhouse:http://localhost:8123/clickhouse_analytics").
        String jdbcUrl = "jdbc:clickhouse:" + clickHouseUrl + "/" + database;
        Properties props = new Properties();
        props.setProperty("user", user);
        if (password != null && !password.isBlank()) {
            props.setProperty("password", password);
        }
        return new ClickHouseDataSource(jdbcUrl, props);
    }

    @Bean(name = "clickHouseJdbcTemplate")
    public JdbcTemplate clickHouseJdbcTemplate(@Qualifier("clickHouseDataSource") DataSource clickHouseDataSource) {
        return new JdbcTemplate(clickHouseDataSource);
    }
}
