package io.restaurantos.hr.adms;

import io.restaurantos.hr.adms.AttlogParseOutcome.Punch;
import io.restaurantos.hr.adms.AttlogParseOutcome.Rejection;
import io.restaurantos.hr.entity.AttendancePunchEntity.PunchType;
import org.springframework.stereotype.Component;

import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;

/**
 * Parser for a tab-separated ADMS/iClock ATTLOG line.
 *
 * <p>The wire format has no official specification and the field count varies by firmware, so fields
 * are read positionally: reference, timestamp, status, verify mode, work code. Anything beyond is
 * ignored.
 *
 * <h2>Three things changed in 25-05, and each was losing punches</h2>
 *
 * <p><b>1. It can no longer return nothing.</b> Every input now yields an
 * {@link AttlogParseOutcome} — a {@link Punch} or a named {@link Rejection} carrying the raw line.
 * See that type for why an absent return was the defect rather than a style choice.
 *
 * <p><b>2. The minimum field count is two, not four.</b> The Go reference implementation, probed
 * against real hardware, identifies a punch from a reference and a timestamp and defaults the rest.
 * Requiring four meant a firmware emitting three lost <em>every punch it ever sent</em>, silently and
 * forever. A line with no status now reports {@link PunchType#UNKNOWN} rather than being discarded —
 * an unknown direction is a problem an administrator can fix; a missing row is one they cannot see.
 *
 * <p><b>3. The timezone is a parameter, not a constant.</b> It used to be {@code Asia/Karachi},
 * compiled in. A device in another country had every punch stored hours out, with a plausible-looking
 * time that nothing would flag. 25-03 gave each device its own zone; this reads it.
 *
 * <p><b>The zone is applied only to the device-local pattern.</b> A Unix epoch already names an
 * instant; adding a device offset to it would move every such punch by hours and leave a
 * plausible-looking time behind, which is the worst kind of wrong — a test asserts an epoch parses
 * identically under two different zones.
 */
@Component
public class AttlogLineParser {

    private static final DateTimeFormatter DEVICE_LOCAL = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss");

    /** The zone assumed when a caller has no device row — matches the historical compiled-in constant. */
    public static final ZoneId DEFAULT_DEVICE_ZONE = ZoneId.of("Asia/Karachi");

    public AttlogParseOutcome parse(String line, ZoneId deviceZone) {
        if (line == null || line.isBlank()) {
            return new Rejection(Rejection.Reason.BLANK_LINE, line == null ? "" : line);
        }
        // -1 keeps trailing empty fields, so "1001\t...\t\t" is five fields rather than three and a
        // device that pads with empties is not mistaken for one that truncates.
        String[] f = line.split("\t", -1);
        if (f.length < 2) {
            return new Rejection(Rejection.Reason.TOO_FEW_FIELDS, line);
        }
        String ref = f[0].trim();
        if (ref.isEmpty()) {
            return new Rejection(Rejection.Reason.MISSING_DEVICE_USER_REF, line);
        }
        Instant when = parseTimestamp(f[1].trim(), deviceZone == null ? DEFAULT_DEVICE_ZONE : deviceZone);
        if (when == null) {
            return new Rejection(Rejection.Reason.UNPARSEABLE_TIMESTAMP, line);
        }
        PunchType type = f.length > 2 ? punchType(f[2].trim()) : PunchType.UNKNOWN;
        String workCode = f.length > 4 && !f[4].isBlank() ? f[4].trim() : null;
        return new Punch(ref, when, type, workCode);
    }

    /** Convenience for callers with no device row. Prefer the two-argument form. */
    public AttlogParseOutcome parse(String line) {
        return parse(line, DEFAULT_DEVICE_ZONE);
    }

    /**
     * The device-local pattern, or a Unix epoch. The reference parser accepts both and firmware in the
     * wild emits both.
     */
    private static Instant parseTimestamp(String raw, ZoneId deviceZone) {
        if (raw.isEmpty()) {
            return null;
        }
        // An all-digit value is an epoch: it already names an instant, so NO zone is applied.
        if (raw.chars().allMatch(Character::isDigit)) {
            try {
                return Instant.ofEpochSecond(Long.parseLong(raw));
            } catch (NumberFormatException e) {
                return null;
            }
        }
        try {
            return LocalDateTime.parse(raw, DEVICE_LOCAL).atZone(deviceZone).toInstant();
        } catch (RuntimeException e) {
            return null;
        }
    }

    private static PunchType punchType(String status) {
        return switch (status) {
            case "0" -> PunchType.IN;
            case "1" -> PunchType.OUT;
            default -> PunchType.UNKNOWN;
        };
    }
}
