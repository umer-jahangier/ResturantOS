package io.restaurantos.file.exception;

/**
 * An upload declared as an image is not one, or is too large (19b-01).
 *
 * <h2>Why this is not a {@code ResponseStatusException}</h2>
 *
 * <p>It was, and that silently produced a 500. shared-lib's {@code GlobalExceptionHandler} has no
 * {@code ResponseStatusException} mapping, so the exception fell through to its catch-all
 * {@code Exception} handler and came back as
 * {@code {"code":"INTERNAL_ERROR","message":"An unexpected error occurred"}}. The upload WAS
 * correctly refused — nothing was stored — but the carefully-worded reason ("That file is not a
 * JPEG, PNG or WebP image. Renaming a file does not change what it is") never reached the user,
 * who instead saw a server crash for something they could have fixed in ten seconds.
 *
 * <p>A dedicated type lets {@code FileController} map it explicitly, the same way it already maps
 * {@code QuotaExceededException} locally.
 *
 * <h2>Why 422 and not 400</h2>
 *
 * <p>The request is well formed — it is a valid multipart upload with the expected part. What is
 * wrong is the CONTENT of the entity, which is exactly what 422 means. The frontend leans on the
 * distinction: a 400 is "we sent something malformed, show a generic failure", while a 422 here
 * carries a message written for the person holding the mouse and is displayed verbatim.
 */
public class InvalidImageException extends RuntimeException {

    public InvalidImageException(String message) {
        super(message);
    }
}
