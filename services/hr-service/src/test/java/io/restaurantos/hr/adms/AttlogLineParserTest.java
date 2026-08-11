package io.restaurantos.hr.adms;

import io.restaurantos.hr.adms.AttlogParseOutcome.Punch;
import io.restaurantos.hr.adms.AttlogParseOutcome.Rejection;
import io.restaurantos.hr.entity.AttendancePunchEntity.PunchType;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.time.ZoneId;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * The parser, as a plain unit test — no container, no Spring.
 *
 * <p>Every case here corresponds to a punch that used to disappear. Before 25-05 the parser returned
 * an empty {@code Optional} for four distinct inputs, and an empty Optional is indistinguishable from
 * a line that was never sent, so each of them meant an employee's hour ceased to exist while the
 * device was told {@code 200 OK} and deleted its buffer.
 */
class AttlogLineParserTest {

    private final AttlogLineParser parser = new AttlogLineParser();

    private static final ZoneId KARACHI = ZoneId.of("Asia/Karachi");   // UTC+5, no DST
    private static final ZoneId LONDON = ZoneId.of("Europe/London");   // UTC+1 in June

    private Punch punch(String line, ZoneId zone) {
        AttlogParseOutcome outcome = parser.parse(line, zone);
        assertThat(outcome).isInstanceOf(Punch.class);
        return (Punch) outcome;
    }

    private Rejection rejection(String line) {
        AttlogParseOutcome outcome = parser.parse(line, KARACHI);
        assertThat(outcome).isInstanceOf(Rejection.class);
        return (Rejection) outcome;
    }

    @Test
    void aWellFormedSevenFieldLineParsesToAPunchWithItsWorkCode() {
        Punch p = punch("1001\t2026-06-15 09:30:00\t0\t1\tWC-7\t0\t0", KARACHI);

        assertThat(p.deviceUserRef()).isEqualTo("1001");
        assertThat(p.deviceReportedAt()).isEqualTo(Instant.parse("2026-06-15T04:30:00Z"));
        assertThat(p.punchType()).isEqualTo(PunchType.IN);
        assertThat(p.workCode())
                .as("field 4 is the work code in all three reference parsers, not a record id")
                .isEqualTo("WC-7");
    }

    /**
     * The reference implementation's minimum is two. This parser's minimum was four, so a firmware
     * emitting three lost every punch it ever sent, silently and forever.
     */
    @Test
    void aTwoFieldLineParsesWithAnUnknownDirectionRatherThanBeingDiscarded() {
        Punch p = punch("1002\t2026-06-15 09:30:00", KARACHI);

        assertThat(p.deviceUserRef()).isEqualTo("1002");
        assertThat(p.punchType())
                .as("an unknown direction is a problem an admin can fix; a missing row is one they cannot see")
                .isEqualTo(PunchType.UNKNOWN);
        assertThat(p.workCode()).isNull();
    }

    @Test
    void aThreeFieldLineParses() {
        Punch p = punch("1003\t2026-06-15 09:30:00\t1", KARACHI);

        assertThat(p.punchType()).isEqualTo(PunchType.OUT);
    }

    /**
     * An epoch already names an instant. Applying the device's offset to it would move every such
     * punch by hours and leave a plausible-looking time behind — the worst kind of wrong, because
     * nothing downstream would flag it.
     */
    @Test
    void anEpochTimestampIsThatExactInstantUnderEveryZone() {
        Instant expected = Instant.ofEpochSecond(1781512200L);

        assertThat(punch("1004\t1781512200\t0\t1", KARACHI).deviceReportedAt()).isEqualTo(expected);
        assertThat(punch("1004\t1781512200\t0\t1", LONDON).deviceReportedAt())
                .as("no offset is applied to an epoch, in any zone")
                .isEqualTo(expected);
    }

    /**
     * A per-device zone that is accepted and then ignored is worse than a hard-coded constant: it
     * looks configured. Asserted by parsing one line under two zones and requiring two instants.
     */
    @Test
    void theSameDeviceLocalLineUnderTwoZonesYieldsTwoDifferentInstants() {
        String line = "1005\t2026-06-15 09:30:00\t0\t1";

        Instant inKarachi = punch(line, KARACHI).deviceReportedAt();
        Instant inLondon = punch(line, LONDON).deviceReportedAt();

        assertThat(inKarachi).isEqualTo(Instant.parse("2026-06-15T04:30:00Z"));
        assertThat(inLondon).isEqualTo(Instant.parse("2026-06-15T08:30:00Z"));
        assertThat(inKarachi).isNotEqualTo(inLondon);
    }

    @Test
    void anEmptyReferenceAnUnparseableTimestampAndALineWithNoTabAreAllNamedRejections() {
        assertThat(rejection("\t2026-06-15 09:30:00\t0\t1").reason())
                .isEqualTo(Rejection.Reason.MISSING_DEVICE_USER_REF);
        assertThat(rejection("1006\tnot-a-timestamp\t0\t1").reason())
                .isEqualTo(Rejection.Reason.UNPARSEABLE_TIMESTAMP);
        assertThat(rejection("no-tabs-at-all").reason())
                .isEqualTo(Rejection.Reason.TOO_FEW_FIELDS);
    }

    @Test
    void aNullOrBlankLineIsARejectionNamingThatCauseAndNeverAnException() {
        assertThat(((Rejection) parser.parse(null, KARACHI)).reason()).isEqualTo(Rejection.Reason.BLANK_LINE);
        assertThat(rejection("   ").reason()).isEqualTo(Rejection.Reason.BLANK_LINE);
        assertThat(rejection("").reason()).isEqualTo(Rejection.Reason.BLANK_LINE);
    }

    /**
     * The raw line is the only evidence of a punch nobody could interpret. Trimming it destroys the
     * very detail an administrator needs to work out what the device sent — a stray space is often
     * exactly the difference.
     */
    @Test
    void aRejectionCarriesTheRawLineVerbatimIncludingItsWhitespace() {
        String raw = "  1007\tnot-a-timestamp\t0\t1  ";

        assertThat(rejection(raw).rawLine()).isEqualTo(raw);
    }

    /**
     * Structural: the whole point of the sealed type is that a contributor cannot add one more silent
     * discard without naming it. If a third permitted subtype appears, this fails and someone has to
     * think about it.
     */
    @Test
    void thereIsNoOutcomeOtherThanAPunchOrANamedRejection() {
        assertThat(AttlogParseOutcome.class.getPermittedSubclasses())
                .containsExactlyInAnyOrder(Punch.class, Rejection.class);
    }
}
