package io.restaurantos.hr.adms;

import io.restaurantos.hr.entity.AttendanceDeviceEntity;
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
 * <h2>The tally exists so a zero-yield batch cannot be silent</h2>
 *
 * <p>The device is told {@code OK} whatever happens — that is the protocol and this plan does not
 * change it. So the only place a batch that produced nothing can become visible is the server log.
 * A batch of five that writes zero rows and says {@code OK} is the same failure shape as an audit log
 * reporting healthy at zero rows, except that here each missing row is an unpaid hour.
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
     * What one uploaded batch did.
     *
     * @param inserted  genuinely new punches
     * @param duplicates lines that resolved to a punch already stored — expected, not exceptional
     *                   (D-25-05): devices retransmit their offline buffer and must not double-count
     * @param quarantined lines whose device user maps to no employee — retained, never dropped
     * @param rejected  lines the parser could not interpret. 25-06 gives these a destination; until
     *                  then they are counted and logged, which is already more than they used to get
     */
    public record BatchTally(int lines, int inserted, int duplicates, int quarantined, int rejected) {
        /** True when nothing at all came of a body that was not empty. */
        boolean yieldedNothing() {
            return lines > 0 && inserted == 0 && duplicates == 0 && quarantined == 0;
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
                rejected++;
                // 25-06 gives this a durable destination. Until then it is at least counted and named,
                // where before it produced nothing at all — no row, no log line, no trace.
                log.warn("ATTLOG line rejected: device={} reason={} bytes={}",
                        device.getSerialNo(), r.reason(), line.length());
                continue;
            }
            AttlogParseOutcome.Punch p = (AttlogParseOutcome.Punch) outcome;
            IngestResult result = punchIngestService.ingest(
                    device, p.deviceUserRef(), p.deviceReportedAt(), p.punchType(), p.workCode(), line);
            switch (result) {
                case INSERTED -> inserted++;
                case DUPLICATE -> duplicates++;
                case QUARANTINED -> quarantined++;
            }
        }

        BatchTally tally = new BatchTally(lines, inserted, duplicates, quarantined, rejected);
        if (tally.yieldedNothing()) {
            // The one warning the acceptance criteria require. Names the device, what the device SAID
            // the body was, and how big it was — the three facts that distinguish "the firmware sent
            // a shape we cannot read" from "the body never arrived".
            log.warn("ATTLOG batch yielded nothing: device={} declaredContentType={} bytes={} lines={} rejected={}",
                    device.getSerialNo(), declaredContentType, body.getBytes(java.nio.charset.StandardCharsets.UTF_8).length,
                    tally.lines(), tally.rejected());
        }
        return tally;
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
