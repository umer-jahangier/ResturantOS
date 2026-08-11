package io.restaurantos.shared.api;

import ch.qos.logback.classic.Level;
import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import io.restaurantos.shared.exception.DuplicateValueException;
import io.restaurantos.shared.exception.FieldValidationException;
import org.junit.jupiter.api.Test;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;

import java.util.List;
import java.util.regex.Pattern;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * The field-path contract: a refusal names the input the user must change.
 *
 * <p>This is the backend half of D-35-03. The frontend's {@code ApiError} already parses
 * {@code {error:{code,message,details:[{field,issue}],traceId}}} into {@code fieldErrors} — it has
 * since phase 3 — but almost nothing populated {@code details} outside bean validation, so a form
 * had nothing to bind to and every business refusal rendered as a banner at best. These tests pin
 * the two exception types that close that gap, and pin the three things that must NOT change while
 * closing it: the envelope shape, the empty-details honesty of the JDBC-level conflict, and the
 * catch-all's stack-trace logging.
 *
 * <p>Deliberately a plain unit test over the handler object rather than a {@code @WebMvcTest}: the
 * question is what the handler returns, and answering it without a Spring context keeps this
 * runnable in shared-lib, which has no application to boot.
 */
class FieldErrorContractTest {

    private final GlobalExceptionHandler handler = new GlobalExceptionHandler();

    /**
     * Vocabulary that belongs to the database and must never reach a caller.
     *
     * <p>Word-bounded so ordinary prose survives: an instruction may say "the table is full" in some
     * other product, but none of ours does, and the cost of a false positive here is a reworded
     * message while the cost of a false negative is a schema leak in an error toast.
     */
    private static final Pattern DB_VOCABULARY = Pattern.compile(
            "(?i)\\b(constraint|relation|pkey|fkey|violates|duplicate key value|sqlstate|"
                    + "pg_[a-z_]+|[a-z_]+_(pkey|fkey|key)\\b)|\\bat io\\.restaurantos\\.|Caused by:");

    // ── Behaviour 1 ────────────────────────────────────────────────────────────

    @Test
    void singleViolationProduces422WithTheCallersCodeAndExactlyOneNamedField() {
        var ex = new FieldValidationException("LEAVE_RANGE_INVALID", "endDate",
                "End date must be on or after the start date");

        ResponseEntity<ApiError> response = handler.handleFieldValidation(ex);

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.UNPROCESSABLE_ENTITY);
        assertThat(response.getBody()).isNotNull();
        assertThat(response.getBody().error().code()).isEqualTo("LEAVE_RANGE_INVALID");
        assertThat(response.getBody().error().details())
                .singleElement()
                .satisfies(d -> {
                    assertThat(d.field()).isEqualTo("endDate");
                    assertThat(d.issue()).isEqualTo("End date must be on or after the start date");
                });
    }

    // ── Behaviour 2 ────────────────────────────────────────────────────────────

    @Test
    void severalViolationsProduceOneDetailsEntryEachInTheOrderSupplied() {
        var ex = new FieldValidationException("SHIFT_INVALID", "Shift could not be saved", List.of(
                new FieldValidationException.Violation("name", "Enter a name for this shift"),
                new FieldValidationException.Violation("endTime", "End time must be after start time"),
                new FieldValidationException.Violation("daysOfWeek", "Choose at least one day")));

        ResponseEntity<ApiError> response = handler.handleFieldValidation(ex);

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.UNPROCESSABLE_ENTITY);
        assertThat(response.getBody()).isNotNull();
        assertThat(response.getBody().error().details())
                .extracting(ApiError.FieldError::field)
                .containsExactly("name", "endTime", "daysOfWeek");
    }

    // ── Behaviour 3 ────────────────────────────────────────────────────────────

    @Test
    void duplicateValueProduces409WithDuplicateValueCodeAndTheCollidingField() {
        var ex = new DuplicateValueException("employeeNo",
                "Employee number EMP-001 is already used by another employee. Choose a different number.");

        ResponseEntity<ApiError> response = handler.handleDuplicateValue(ex);

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
        assertThat(response.getBody()).isNotNull();
        assertThat(response.getBody().error().code()).isEqualTo("DUPLICATE_VALUE");
        assertThat(response.getBody().error().details())
                .singleElement()
                .satisfies(d -> assertThat(d.field()).isEqualTo("employeeNo"));
    }

    // ── Behaviour 4 ────────────────────────────────────────────────────────────

    /**
     * The exception's cause carries the driver's own message. The response must not.
     *
     * <p>Asserting only on hand-written instructions would prove nothing — of course a string we
     * authored has no schema in it. The exceptions here are constructed the way a service under a
     * failing write constructs them: with the JDBC exception as the cause.
     */
    @Test
    void noResponseBodyEchoesDatabaseVocabularyOrAStackFrame() {
        var driverFailure = new RuntimeException(
                "ERROR: duplicate key value violates unique constraint \"employee_tenant_id_employee_no_key\"\n"
                        + "  Detail: Key (tenant_id, employee_no)=(1, EMP-001) already exists.");

        List<ResponseEntity<ApiError>> responses = List.of(
                handler.handleFieldValidation(new FieldValidationException(
                        "EMPLOYEE_INVALID", "employeeNo", "Enter an employee number", driverFailure)),
                handler.handleDuplicateValue(new DuplicateValueException(
                        "employeeNo", "That employee number is already in use", driverFailure)),
                handler.handleDataIntegrity(new DataIntegrityViolationException(
                        driverFailure.getMessage(), driverFailure)));

        for (ResponseEntity<ApiError> response : responses) {
            assertThat(renderBody(response))
                    .as("response body must not leak the database's own vocabulary")
                    .doesNotContainPattern(DB_VOCABULARY);
        }
    }

    // ── Behaviour 5 ────────────────────────────────────────────────────────────

    /**
     * A unique-constraint violation caught at the JDBC layer genuinely does not know which form
     * field the user typed. Reporting no field is honest; guessing one would send the user to edit
     * a field that may be perfectly correct, which is worse than saying nothing.
     */
    @Test
    void jdbcLevelConflictStillProduces409WithNoGuessedField() {
        ResponseEntity<ApiError> response = handler.handleDataIntegrity(
                new DataIntegrityViolationException("duplicate key value violates unique constraint \"x_key\""));

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
        assertThat(response.getBody()).isNotNull();
        assertThat(response.getBody().error().code()).isEqualTo("CONFLICT");
        assertThat(response.getBody().error().details()).isEmpty();
    }

    // ── Behaviour 6 ────────────────────────────────────────────────────────────

    /**
     * The net under everything else stays in place. This plan narrows what falls into the catch-all;
     * removing or quieting it would mean an unexpected 500 left no trace anywhere.
     */
    @Test
    void catchAllStillReturns500AndStillLogsTheStackTrace() {
        Logger logger = (Logger) LoggerFactory.getLogger(GlobalExceptionHandler.class);
        ListAppender<ILoggingEvent> appender = new ListAppender<>();
        appender.start();
        logger.addAppender(appender);
        try {
            ResponseEntity<ApiError> response =
                    handler.handleUnexpected(new IllegalStateException("something genuinely unforeseen"));

            assertThat(response.getStatusCode()).isEqualTo(HttpStatus.INTERNAL_SERVER_ERROR);
            assertThat(response.getBody()).isNotNull();
            assertThat(response.getBody().error().code()).isEqualTo("INTERNAL_ERROR");
            assertThat(appender.list)
                    .as("the stack trace must still be logged — the response deliberately says nothing")
                    .anySatisfy(event -> {
                        assertThat(event.getLevel()).isEqualTo(Level.ERROR);
                        assertThat(event.getThrowableProxy()).isNotNull();
                    });
        } finally {
            logger.detachAppender(appender);
        }
    }

    // ── The envelope itself is unchanged ───────────────────────────────────────

    /**
     * Bean validation's 400 is the one path that already worked and that the client already parses.
     * A second envelope shape would need a second parser, so this asserts the new handlers reuse
     * the existing four-argument factory rather than introducing one.
     */
    @Test
    void newHandlersReuseTheExistingEnvelopeShape() {
        ApiError fromNewHandler = handler.handleFieldValidation(
                new FieldValidationException("X", "f", "i")).getBody();
        ApiError fromExistingFactory = ApiError.of("X", "i", List.of(new ApiError.FieldError("f", "i")), "unknown");

        assertThat(fromNewHandler).isNotNull();
        assertThat(fromNewHandler.error().details()).isEqualTo(fromExistingFactory.error().details());
        assertThat(fromNewHandler.error().code()).isEqualTo(fromExistingFactory.error().code());
    }

    // ── Indexed paths, in the one spelling the client can bind ─────────────────

    /**
     * Spring's binding result spells an indexed path {@code slabs[0].ratePct}; the web client binds
     * {@code slabs.0.ratePct}.
     *
     * <p>The difference is not cosmetic and it is not caught by any flat-field test, because no flat
     * path contains a bracket. {@code frontend/lib/forms/server-field-errors.ts} splits a path on
     * "." and walks the form's values, so the first segment of {@code slabs[0].ratePct} is the
     * literal string {@code "slabs[0]"}, matches no key, and the message is demoted to a form-level
     * sentence above the table — one error, no indication which of six rows produced it, which is
     * the exact experience this phase exists to remove.
     */
    @Test
    void anIndexedPathIsEmittedInTheDottedFormTheClientBinds() throws Exception {
        var target = new SlabTableBody();
        var binding = new org.springframework.validation.BeanPropertyBindingResult(target, "body");
        binding.rejectValue("slabs[0].ratePct", "DecimalMax", "A tax rate cannot exceed 100%");
        binding.rejectValue("effectiveFrom", "NotNull", "Enter the date this takes effect");

        var parameter = new org.springframework.core.MethodParameter(
                FieldErrorContractTest.class.getDeclaredMethod("dummyEndpoint", SlabTableBody.class), 0);
        var ex = new org.springframework.web.bind.MethodArgumentNotValidException(parameter, binding);

        List<ApiError.FieldError> details = handler.handleValidation(ex).getBody().error().details();

        assertThat(details).extracting(ApiError.FieldError::field)
                .as("brackets must not survive; a flat path must be untouched")
                .containsExactly("slabs.0.ratePct", "effectiveFrom");
    }

    @SuppressWarnings("unused")
    private void dummyEndpoint(SlabTableBody body) {
        // Exists only so MethodParameter has a real method to describe. Never invoked.
    }

    /** Minimal stand-in for a request body carrying an indexed collection of nested objects. */
    public static class SlabTableBody {
        // Mutable and pre-populated: BeanPropertyBindingResult reads the ACTUAL field value when a
        // path is rejected, so an immutable or empty list makes it try to grow the collection.
        private List<SlabRow> slabs = new java.util.ArrayList<>(List.of(new SlabRow()));
        private String effectiveFrom;

        public List<SlabRow> getSlabs() {
            return slabs;
        }

        public void setSlabs(List<SlabRow> slabs) {
            this.slabs = slabs;
        }

        public String getEffectiveFrom() {
            return effectiveFrom;
        }

        public void setEffectiveFrom(String effectiveFrom) {
            this.effectiveFrom = effectiveFrom;
        }
    }

    public static class SlabRow {
        private String ratePct;

        public String getRatePct() {
            return ratePct;
        }

        public void setRatePct(String ratePct) {
            this.ratePct = ratePct;
        }
    }

    private static String renderBody(ResponseEntity<ApiError> response) {
        ApiError body = response.getBody();
        assertThat(body).isNotNull();
        StringBuilder sb = new StringBuilder()
                .append(body.error().code()).append(' ').append(body.error().message());
        for (ApiError.FieldError detail : body.error().details()) {
            sb.append(' ').append(detail.field()).append(' ').append(detail.issue());
        }
        return sb.toString();
    }
}
