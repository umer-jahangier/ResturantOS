package io.restaurantos.shared.testsupport;

import org.hibernate.resource.jdbc.spi.StatementInspector;

import java.util.List;
import java.util.Optional;
import java.util.concurrent.CopyOnWriteArrayList;

/**
 * Records the SQL Hibernate actually hands to JDBC.
 *
 * <p>Registered by property, not by bean:
 * {@code spring.jpa.properties.hibernate.session_factory.statement_inspector=<this FQCN>}.
 * Hibernate instantiates it reflectively, so the capture buffer has to be static — the test
 * never holds the instance. Recording is off by default and switched on around the one
 * statement under examination, so context startup, Liquibase and fixture inserts do not
 * flood the buffer.
 *
 * <p>Why SQL rather than a mapping-metadata assertion: whether a tenant predicate is
 * <i>bound</i> is a fact about Hibernate's internal model, and reading it is reading our own
 * belief back to ourselves. Whether the predicate reaches the database is the only thing that
 * isolates a tenant. This class exists to make the second question answerable.
 */
public class CapturingStatementInspector implements StatementInspector {

    private static final List<String> CAPTURED = new CopyOnWriteArrayList<>();
    private static volatile boolean recording;

    /** Begins a fresh recording window; drops anything captured earlier. */
    public static void start() {
        CAPTURED.clear();
        recording = true;
    }

    public static void stop() {
        recording = false;
    }

    public static List<String> captured() {
        return List.copyOf(CAPTURED);
    }

    /** The first captured statement mentioning {@code needle} — normally the table name. */
    public static Optional<String> firstContaining(String needle) {
        return CAPTURED.stream().filter(sql -> sql.contains(needle)).findFirst();
    }

    /**
     * How many times {@code tenant_id} appears in the statement's WHERE clause.
     *
     * <p>Not {@code sql.contains("tenant_id")}: every one of these SELECTs lists {@code tenant_id}
     * as a projected COLUMN, so that assertion is satisfied by a query with no WHERE clause at all
     * and reports green on a completely unfiltered read. It passed here before it was noticed —
     * the same class of defect this whole file exists to catch, one level up.
     */
    public static int tenantPredicateCount(String sql) {
        int where = sql.toLowerCase(java.util.Locale.ROOT).indexOf(" where ");
        if (where < 0) {
            return 0;
        }
        int count = 0;
        for (int i = sql.indexOf("tenant_id", where); i >= 0; i = sql.indexOf("tenant_id", i + 1)) {
            count++;
        }
        return count;
    }

    @Override
    public String inspect(String sql) {
        if (recording) {
            CAPTURED.add(sql);
        }
        return sql;
    }
}
