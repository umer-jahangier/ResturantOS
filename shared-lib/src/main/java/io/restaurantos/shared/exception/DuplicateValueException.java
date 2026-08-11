package io.restaurantos.shared.exception;

/**
 * The value the caller supplied collides with a row that already exists, and we know which input
 * it was.
 *
 * <h2>Why this is separate from the JDBC-level conflict</h2>
 *
 * <p>{@code GlobalExceptionHandler#handleDataIntegrity} also answers 409, but it is raised by the
 * driver after the write has been attempted and it genuinely cannot say which form field the user
 * typed — a unique index names columns, not inputs, and mapping one to the other by parsing the
 * constraint name would be guesswork that sends the user to edit the wrong box. That handler
 * therefore returns an empty {@code details} list, and correctly so.
 *
 * <p>This exception is thrown by a service that checked FIRST and knows exactly which request field
 * lost, so it can name it. Both are 409; only this one can be bound to an input.
 *
 * <h2>Disclosure</h2>
 *
 * <p>Answering "that employee number is taken" is an existence oracle, and it is an accepted one
 * (T-29-01-B): every row it can speak about is inside the caller's own tenant, enforced by FORCE
 * RLS, so the only fact disclosed is one the caller could obtain by listing the records they are
 * already entitled to read. Refusing to say so would make the form unusable — the user would be
 * left retyping a number with no way to learn why it keeps failing.
 */
public class DuplicateValueException extends RestaurantOsException {

    /** The request field whose value collided — the path a form binds the message to. */
    private final String field;

    /**
     * @param field       the request DTO's own field name, so the client needs no translation table
     * @param instruction what the person filling the form should do; name the offending value and
     *                    tell them to choose another, never the index or table that detected it
     */
    public DuplicateValueException(String field, String instruction) {
        super("DUPLICATE_VALUE", instruction);
        this.field = field;
    }

    /** As above, preserving the underlying failure for the log without exposing it to the caller. */
    public DuplicateValueException(String field, String instruction, Throwable cause) {
        super("DUPLICATE_VALUE", instruction, cause);
        this.field = field;
    }

    public String getField() {
        return field;
    }
}
