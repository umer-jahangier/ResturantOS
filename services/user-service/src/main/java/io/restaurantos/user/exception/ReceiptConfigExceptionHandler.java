package io.restaurantos.user.exception;

import com.fasterxml.jackson.databind.JsonMappingException;
import io.restaurantos.shared.api.ApiError;
import io.restaurantos.shared.exception.RestaurantOsException;
import io.restaurantos.user.controller.ReceiptConfigController;
import org.slf4j.MDC;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

import java.util.List;
import java.util.stream.Collectors;

/**
 * Error reporting for the receipt-configuration endpoints, scoped to that controller alone.
 *
 * <h2>Why a scoped advice rather than a change to the shared one</h2>
 *
 * <p>{@code GlobalExceptionHandler} already turns a failed {@code @Valid} into a 400 carrying
 * {@code details: [{field, issue}]}, which is exactly what a configuration form needs. What it
 * cannot do without changing behaviour for all twenty services is name the JSON path inside a body
 * Jackson could not even deserialise — an unknown {@code transport} value, for instance, never
 * reaches the validator at all, so the caller would be told only "Request body is missing or
 * malformed" and would have no idea which of forty fields was wrong.
 *
 * <p>A configuration rejected with a bare "invalid request" is functionally the same as one
 * accepted and silently discarded: the operator can act on neither. So this advice is registered
 * with {@code assignableTypes} pointing at one controller and the highest precedence, which makes
 * it impossible for it to change any other endpoint's error shape.
 */
@Order(Ordered.HIGHEST_PRECEDENCE)
@RestControllerAdvice(assignableTypes = ReceiptConfigController.class)
public class ReceiptConfigExceptionHandler {

    private static String traceId() {
        String t = MDC.get("traceId");
        return t != null ? t : "unknown";
    }

    /**
     * A body Jackson refused, reported with the JSON path it choked on.
     *
     * <p>The common case is an enum outside its closed set — a {@code transport} of
     * {@code "bluetooth"} or a {@code cut} of {@code "guillotine"}. Jackson records the field path
     * on the exception; this puts it in the response instead of throwing it away.
     */
    @ExceptionHandler(HttpMessageNotReadableException.class)
    public ResponseEntity<ApiError> handleUnreadableBody(HttpMessageNotReadableException ex) {
        String path = "(body)";
        String detail = "the value could not be read";

        // BOTH Jackson generations, on purpose. Spring Boot 4 puts Jackson 3
        // (`tools.jackson.core`) on the HTTP message-conversion path while this project's shared
        // ObjectMapper bean is still Jackson 2 (`com.fasterxml.jackson.databind`), and both jars
        // are on the classpath. This handler first shipped checking only the Jackson 2 type and
        // silently fell through to "(body)" for every malformed request — the instanceof never
        // matched, because the exception came from the other Jackson.
        if (ex.getCause() instanceof tools.jackson.core.JacksonException jackson3) {
            String joined = jackson3.getPath().stream()
                    .map(ref -> ref.getPropertyName() != null
                            ? ref.getPropertyName()
                            : "[" + ref.getIndex() + "]")
                    .collect(Collectors.joining("."));
            if (!joined.isBlank()) {
                path = joined;
            }
            detail = jackson3.getOriginalMessage();
        } else if (ex.getCause() instanceof JsonMappingException jackson2) {
            String joined = jackson2.getPath().stream()
                    .map(ref -> ref.getFieldName() != null
                            ? ref.getFieldName()
                            : "[" + ref.getIndex() + "]")
                    .collect(Collectors.joining("."));
            if (!joined.isBlank()) {
                path = joined;
            }
            detail = jackson2.getOriginalMessage();
        }

        return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(ApiError.of(
                "RECEIPT_CONFIG_INVALID",
                "Receipt configuration could not be read: " + path + " — " + detail,
                List.of(new ApiError.FieldError(path, detail)),
                traceId()));
    }

    /**
     * Raised when a caller tries to write the printer registry through the branch endpoint's
     * legacy bare-string {@code receiptConfig} field.
     *
     * <p>Declared here, beside the advice, rather than as its own file: the whole reason this type
     * exists is to produce a specific 400 with a specific message, and {@code files_modified} for
     * this plan names this file. It extends {@link RestaurantOsException}, which the SHARED
     * handler already maps to 400 — that matters, because the refusal is raised from
     * {@code BranchController}'s path, not this controller's, so a scoped advice would never see
     * it.
     */
    public static class LegacyReceiptConfigWriteException extends RestaurantOsException {
        public LegacyReceiptConfigWriteException(String message) {
            super("RECEIPT_CONFIG_LEGACY_WRITE", message);
        }
    }
}
