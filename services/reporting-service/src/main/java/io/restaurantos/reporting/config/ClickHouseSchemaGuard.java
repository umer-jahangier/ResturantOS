package io.restaurantos.reporting.config;

import jakarta.annotation.PostConstruct;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

import java.util.List;

/**
 * Fail-fast startup check: if the four analytics fact tables provisioned by 12-02
 * (deploy/clickhouse/V001__analytics_facts.sql) are not present in the configured ClickHouse
 * database, refuse to finish booting. Silent booting against a missing schema is how you get an
 * ETL that drops every event with no operator-visible signal.
 */
@Component
public class ClickHouseSchemaGuard {

    private static final Logger log = LoggerFactory.getLogger(ClickHouseSchemaGuard.class);

    private static final List<String> REQUIRED_FACT_TABLES = List.of(
            "sales_order_facts", "sales_item_facts", "purchase_tax_facts", "till_session_facts");

    private final JdbcTemplate clickHouseJdbcTemplate;
    private final String clickHouseDatabase;

    public ClickHouseSchemaGuard(
            @Qualifier("clickHouseJdbcTemplate") JdbcTemplate clickHouseJdbcTemplate,
            @Value("${restaurantos.clickhouse.database}") String clickHouseDatabase) {
        this.clickHouseJdbcTemplate = clickHouseJdbcTemplate;
        this.clickHouseDatabase = clickHouseDatabase;
    }

    @PostConstruct
    public void verifyFactTablesExist() {
        String sql = "SELECT count() FROM system.tables WHERE database = ? AND name IN (?, ?, ?, ?)";
        Long present = clickHouseJdbcTemplate.queryForObject(sql, Long.class,
                clickHouseDatabase,
                REQUIRED_FACT_TABLES.get(0), REQUIRED_FACT_TABLES.get(1),
                REQUIRED_FACT_TABLES.get(2), REQUIRED_FACT_TABLES.get(3));
        if (present == null || present < REQUIRED_FACT_TABLES.size()) {
            throw new IllegalStateException(
                    "reporting-service startup check FAILED: expected " + REQUIRED_FACT_TABLES.size()
                            + " ClickHouse fact tables (" + REQUIRED_FACT_TABLES
                            + ") in database '" + clickHouseDatabase + "' but found " + present
                            + ". Run deploy/clickhouse/apply.sh against the target ClickHouse instance "
                            + "before starting reporting-service.");
        }
        log.info("ClickHouseSchemaGuard: verified all {} analytics fact tables are present in database '{}'.",
                REQUIRED_FACT_TABLES.size(), clickHouseDatabase);
    }
}
