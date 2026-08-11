package io.restaurantos.pos.domain.enums;

/**
 * The lifecycle of one issued document.
 *
 * <p>{@link #ISSUED} is the only status this plan (26-03) ever writes: the server has produced the
 * document and stored it, and nothing has been asked to print it. The browser's HTML bill (26-05)
 * consumes an ISSUED row and never moves it — printing on paper through {@code window.print()}
 * leaves the server no way to know whether ink reached paper, and a status that claims otherwise
 * would be a lie the reprint screen repeats.
 *
 * <p>The remaining values are written by the agent path: {@link #QUEUED} when a job is handed to
 * the print agent, {@link #CLAIMED} while an agent holds it, {@link #PRINTED} on the agent's
 * acknowledgement, {@link #FAILED} on a retryable error, and {@link #DEAD_LETTERED} once the
 * attempt budget is spent. They are declared here rather than added later so the CHECK constraint
 * in {@code V13__print_jobs.sql} does not need a migration per plan.
 */
public enum PrintJobStatus {
    ISSUED,
    QUEUED,
    CLAIMED,
    PRINTED,
    FAILED,
    DEAD_LETTERED
}
