package io.restaurantos.hr.adms;

import io.restaurantos.hr.entity.AttendanceDeviceEntity;
import io.restaurantos.hr.entity.AttendanceQuarantineEntity.Reason;
import io.restaurantos.hr.service.PunchIngestService;
import io.restaurantos.hr.service.PunchIngestService.IngestResult;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.time.ZoneId;

/**
 * Splits an ATTLOG body into lines, parses each in the device's own timezone, dispatches it, and
 * reports what happened to the batch as a whole.
 *
 * <h2>Why this is a service rather than a loop in the controller</h2>
 *
 * <p>Two reasons, and the second is the operative one. A controller that splits, parses and
 * dispatches is doing service work. And {@code AdmsController} is edited again by 25-07, which runs
 * in the same wave as 25-06 — 25-06 owns what happens to a {@link AttlogParseOutcome.Rejection} and
 * needs the dispatch point. Putting the dispatch point in its own file is what lets those two plans
 * run in parallel rather than one waiting on the other for a file.
 *
 * <h2>The tally is the accounting, and it must sum</h2>
 *
 * <p>The device is told {@code OK} whatever happens — that is the protocol and neither plan changes
 * it. So the only place a batch that produced nothing can become visible is the server. Since 25-06
 * every line reaches one of four outcomes, so {@code inserted + duplicates + quarantined + rejected}
 * equals {@code lines} by construction; {@link BatchTally#unaccounted()} is that invariant written
 * down, so the day a fifth branch is added without a destination it does not pass silently.
 */
@Service
public class AdmsBatchIngestService {

    private static final Logger log = LoggerFactory.getLogger(AdmsBatchIngestService.class);

    private final AttlogLineParser parser;
    private final PunchIngestService punchIngestService;

    public AdmsBatchIngestService(AttlogLineParser parser, PunchIngestService punchIngestService) {
        this.parser = parser;
        this.punchIngestService = punchIngestService;
    }

    /**
     * What one uploaded batch did. <b>The four outcomes sum to {@link #lines()}</b> — that is the
     * accounting D-25-03 requires and {@link #unaccounted()} is how a breach of it becomes visible.
     *
     * @param inserted  genuinely new punches
     * @param duplicates lines that resolved to a punch or a queue entry already stored — expected,
     *                   not exceptional (D-25-05): devices retransmit their offline buffer and must
     *                   not double-count, in the punch table OR in the queue a person has to clear
     * @param quarantined new queue entries for a device user that maps to no employee
     * @param rejected  new queue entries for a line the parser could not interpret. Before 25-06
     *                  these were counted and logged and stored nowhere; they are now rows
     */
    public record BatchTally(int lines, int inserted, int duplicates, int quarantined, int rejected) {

        /**
         * Lines that reached no destination at all. <b>Structurally zero</b> — every branch below
         * returns one of the four outcomes — which is exactly why it is worth asserting: this is the
         * number that would move if a fifth branch were ever added without a destination, and it
         * would move silently.
         */
        public int unaccounted() {
            return lines - inserted - duplicates - quarantined - rejected;
        }
    }

    public BatchTally ingestAttlog(AttendanceDeviceEntity device, String body, String declaredContentType) {
        if (body == null || body.isBlank()) {
            return new BatchTally(0, 0, 0, 0, 0);
        }
        ZoneId zone = zoneOf(device);
        int lines = 0;
        int inserted = 0;
        int duplicates = 0;
        int quarantined = 0;
        int rejected = 0;

        for (String line : body.split("\\r?\\n")) {
            if (line.isBlank()) {
                continue; // a trailing newline is not a lost punch
            }
            lines++;
            AttlogParseOutcome outcome = parser.parse(line, zone);
            if (outcome instanceof AttlogParseOutcome.Rejection r) {
                // 25-06 gave this a durable destination: the SAME queue an administrator already
                // reads, distinguished by a reason. Before it, this branch produced a warning and no
                // row — a smaller hole than the silent discard 25-05 removed, and still a hole.
                IngestResult stored = punchIngestService.ingestRejection(device, quarantineReasonFor(r), line);
                switch (stored) {
                    case QUARANTINED -> rejected++;
                    case QUARANTINE_DUPLICATE -> duplicates++;
                    default -> throw new IllegalStateException("A rejection cannot become a punch: " + stored);
                }
                log.warn("ATTLOG line rejected: device={} reason={} bytes={} stored={}",
                        device.getSerialNo(), r.reason(), line.length(), stored);
                continue;
            }
            AttlogParseOutcome.Punch p = (AttlogParseOutcome.Punch) outcome;
            IngestResult result = punchIngestService.ingest(
                    device, p.deviceUserRef(), p.deviceReportedAt(), p.punchType(), p.workCode(), line);
            switch (result) {
                case INSERTED -> inserted++;
                case DUPLICATE, QUARANTINE_DUPLICATE -> duplicates++;
                case QUARANTINED -> quarantined++;
            }
        }

        BatchTally tally = new BatchTally(lines, inserted, duplicates, quarantined, rejected);
        if (tally.unaccounted() != 0) {
            // Should be unreachable: every branch above returns one of four outcomes and each is
            // counted. It is logged rather than asserted because a batch that has already been
            // partly written must still be acknowledged — the device deletes its buffer either way,
            // so throwing here would trade a counting bug for a data-loss bug.
            log.error("ATTLOG accounting breach: device={} declaredContentType={} bytes={} lines={} "
                            + "inserted={} duplicates={} quarantined={} rejected={} UNACCOUNTED={}",
                    device.getSerialNo(), declaredContentType,
                    body.getBytes(java.nio.charset.StandardCharsets.UTF_8).length,
                    tally.lines(), tally.inserted(), tally.duplicates(), tally.quarantined(),
                    tally.rejected(), tally.unaccounted());
        }
        return tally;
    }

    /**
     * The parser's rejection reason as the queue's reason. Written as an exhaustive switch rather
     * than {@code valueOf(name())} on purpose: the two enums are deliberately parallel, and a switch
     * makes the compiler refuse a new parser reason that nobody decided a destination for. A
     * name-based lookup would compile and fail at runtime, on a device, in production.
     */
    private static Reason quarantineReasonFor(AttlogParseOutcome.Rejection r) {
        return switch (r.reason()) {
            case BLANK_LINE -> Reason.BLANK_LINE;
            case TOO_FEW_FIELDS -> Reason.TOO_FEW_FIELDS;
            case MISSING_DEVICE_USER_REF -> Reason.MISSING_DEVICE_USER_REF;
            case UNPARSEABLE_TIMESTAMP -> Reason.UNPARSEABLE_TIMESTAMP;
        };
    }

    /**
     * The device's own zone, falling back to the historical constant if the row carries something a
     * JVM cannot resolve — a bad zone must not stop a punch from being recorded at all.
     */
    private static ZoneId zoneOf(AttendanceDeviceEntity device) {
        String configured = device.getDeviceTimezone();
        if (configured == null || configured.isBlank()) {
            return AttlogLineParser.DEFAULT_DEVICE_ZONE;
        }
        try {
            return ZoneId.of(configured.trim());
        } catch (RuntimeException e) {
            log.warn("Device {} has an unusable timezone '{}'; falling back to {}",
                    device.getSerialNo(), configured, AttlogLineParser.DEFAULT_DEVICE_ZONE);
            return AttlogLineParser.DEFAULT_DEVICE_ZONE;
        }
    }
}
