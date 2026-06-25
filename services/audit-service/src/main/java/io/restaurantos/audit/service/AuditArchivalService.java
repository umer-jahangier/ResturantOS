package io.restaurantos.audit.service;

import lombok.extern.slf4j.Slf4j;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.util.List;

/**
 * Monthly archival job for audit_events partitions.
 * Runs on the 1st of each month at 2 AM:
 *   1. Creates next month's partition via the create_audit_partition() helper.
 *   2. Detaches partitions older than 7 years from the active table.
 *
 * Detached partitions remain in Postgres as standalone tables for compliance
 * archiving — they are no longer queried by default joins on audit_events.
 */
@Service
@Slf4j
public class AuditArchivalService {

    private static final int RETENTION_YEARS = 7;
    private static final DateTimeFormatter PARTITION_SUFFIX_FMT = DateTimeFormatter.ofPattern("yyyy_MM");

    private final JdbcTemplate jdbcTemplate;

    public AuditArchivalService(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    /**
     * Monthly maintenance: create upcoming partition + detach expired partitions.
     * Cron: "0 0 2 1 * ?" = 2 AM on the 1st of every month.
     */
    @Scheduled(cron = "0 0 2 1 * ?")
    @Transactional
    public void runMonthlyMaintenance() {
        log.info("AuditArchivalService: starting monthly maintenance");
        createNextMonthPartition();
        detachExpiredPartitions();
        log.info("AuditArchivalService: monthly maintenance complete");
    }

    /**
     * Creates the partition for next month if it doesn't already exist.
     */
    public void createNextMonthPartition() {
        LocalDate nextMonth = LocalDate.now().plusMonths(1).withDayOfMonth(1);
        log.info("Creating audit partition for month: {}", nextMonth);
        jdbcTemplate.update("SELECT create_audit_partition(?::DATE)", nextMonth.toString());
    }

    /**
     * Detaches partitions whose month is older than 7 years from now.
     * Queries pg_inherits + pg_class to find partition table names,
     * filters by name suffix pattern audit_events_YYYY_MM.
     */
    public void detachExpiredPartitions() {
        LocalDate cutoff = LocalDate.now().minusYears(RETENTION_YEARS).withDayOfMonth(1);
        String cutoffSuffix = PARTITION_SUFFIX_FMT.format(cutoff);

        // Query pg_inherits for all child partitions of audit_events
        List<String> partitionNames = jdbcTemplate.queryForList(
                """
                SELECT c.relname
                FROM pg_inherits pi
                JOIN pg_class p ON p.oid = pi.inhparent
                JOIN pg_class c ON c.oid = pi.inhrelid
                WHERE p.relname = 'audit_events'
                  AND c.relname ~ '^audit_events_\\d{4}_\\d{2}$'
                """,
                String.class
        );

        for (String partitionName : partitionNames) {
            String suffix = partitionName.replaceFirst("^audit_events_", "");
            if (isOlderThanCutoff(suffix, cutoffSuffix)) {
                log.info("Detaching expired audit partition: {}", partitionName);
                jdbcTemplate.execute(
                        "ALTER TABLE audit_events DETACH PARTITION " + partitionName
                );
                log.info("Detached partition {} (older than {} years retention)", partitionName, RETENTION_YEARS);
            }
        }
    }

    /**
     * Returns true if the partition suffix (YYYY_MM format) is before the cutoff suffix.
     * Lexicographic comparison works because the format is zero-padded.
     */
    private boolean isOlderThanCutoff(String partitionSuffix, String cutoffSuffix) {
        return partitionSuffix.compareTo(cutoffSuffix) < 0;
    }
}
