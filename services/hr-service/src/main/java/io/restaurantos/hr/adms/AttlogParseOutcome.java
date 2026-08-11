package io.restaurantos.hr.adms;

import io.restaurantos.hr.entity.AttendancePunchEntity.PunchType;

import java.time.Instant;

/**
 * What happened to one ATTLOG line. Every input produces one of these — <b>there is no third
 * outcome, and in particular no absent one</b>.
 *
 * <h2>Why the empty Optional had to go</h2>
 *
 * <p>{@code AttlogLineParser} used to return {@code Optional<ParsedPunch>}, and an empty Optional is
 * indistinguishable, to every caller, from a line that was never sent. Four separate inputs took that
 * branch — a line of fewer than four fields, a Unix-epoch timestamp, an unparseable timestamp, and an
 * empty reference — and each one meant a punch ceased to exist while the device was told
 * {@code 200 OK}. The device then deletes its buffer. The punch is gone, nothing is logged, and
 * nobody finds out until an employee disputes a payslip at month end.
 *
 * <p>Removing the absent return is the point rather than a tidy-up: while it existed, a contributor
 * could add one more silent discard without changing a signature or failing a test. Now a new failure
 * mode has to name itself in {@link Rejection.Reason}.
 *
 * <p>25-06 owns what happens to a {@link Rejection} — it is retained and surfaced, never dropped
 * (D-25-03). This type is the contract between the two plans.
 */
public sealed interface AttlogParseOutcome permits AttlogParseOutcome.Punch, AttlogParseOutcome.Rejection {

    /**
     * A line that was understood.
     *
     * @param deviceUserRef   the device's own user id — a PIN, not an employee id
     * @param deviceReportedAt the instant the device says the punch happened
     * @param punchType       IN, OUT, or UNKNOWN when the device did not say
     * @param workCode        field index 4.
     *     <p><b>This was called {@code sourceRecordId} and that name was wrong.</b> All three
     *     reference implementations call position 4 the <em>work code</em> — a job/task code the
     *     operator may key in — and none treats it as a record identifier. The old name mattered
     *     because it was load-bearing in a comment claiming it could be used for idempotency, which
     *     would have deduplicated two genuinely different punches that happened to share a work code.
     *     Idempotency is, and remains, {@code (device, device user, timestamp)}.
     *     <p>The database column is still {@code source_record_id}. Renaming a column is a migration
     *     on the ingest path, which 25-06 owns — <b>that rename is handed to 25-06</b>.
     */
    record Punch(String deviceUserRef, Instant deviceReportedAt, PunchType punchType, String workCode)
            implements AttlogParseOutcome {
    }

    /**
     * A line that could not be understood, carrying the original <b>verbatim</b>.
     *
     * @param rawLine the line exactly as received, including leading and trailing whitespace. It is
     *     the only evidence of a punch nobody could interpret; trimming it destroys the very detail
     *     an administrator needs to work out what the device actually sent.
     */
    record Rejection(Reason reason, String rawLine) implements AttlogParseOutcome {

        /** A closed set, so a new silent-discard path cannot be added without naming itself. */
        public enum Reason {
            /** Null, empty, or whitespace only. */
            BLANK_LINE,
            /** Fewer than two tab-separated fields — not even a reference and a time. */
            TOO_FEW_FIELDS,
            /** The device user reference was empty. */
            MISSING_DEVICE_USER_REF,
            /** Neither the device-local pattern nor a Unix epoch. */
            UNPARSEABLE_TIMESTAMP
        }
    }
}
