package io.restaurantos.hr.adms;

import io.restaurantos.hr.entity.AttendancePunchEntity.PunchType;
import org.springframework.stereotype.Component;

import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.Optional;

/**
 * Defensive parser for a tab-separated ADMS/iClock ATTLOG line. The wire format has no official spec
 * and the field count varies by firmware, so we parse the first four fields positionally
 * (PIN, timestamp, status, verifyMode), ignore any extras, and SKIP (never throw on) a line too
 * short to identify a PIN + time. Device timestamps are device-local Asia/Karachi (no DST).
 */
@Component
public class AttlogLineParser {

    private static final ZoneId DEVICE_ZONE = ZoneId.of("Asia/Karachi");
    private static final DateTimeFormatter TS = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss");

    public record ParsedPunch(String deviceUserRef, Instant deviceReportedAt, PunchType punchType, String sourceRecordId) {
    }

    public Optional<ParsedPunch> parse(String line) {
        if (line == null || line.isBlank()) {
            return Optional.empty();
        }
        String[] f = line.split("\t");
        if (f.length < 4) {
            return Optional.empty(); // too few fields to identify PIN + time — skip, do not throw
        }
        String pin = f[0].trim();
        if (pin.isEmpty()) {
            return Optional.empty();
        }
        Instant when;
        try {
            when = LocalDateTime.parse(f[1].trim(), TS).atZone(DEVICE_ZONE).toInstant();
        } catch (Exception e) {
            return Optional.empty();
        }
        PunchType type = switch (f[2].trim()) {
            case "0" -> PunchType.IN;
            case "1" -> PunchType.OUT;
            default -> PunchType.UNKNOWN;
        };
        // Some firmwares carry a device record id in a later field; use it for idempotency if present.
        String sourceRecordId = f.length > 4 && !f[4].isBlank() ? f[4].trim() : null;
        return Optional.of(new ParsedPunch(pin, when, type, sourceRecordId));
    }
}
