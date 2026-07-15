package io.restaurantos.nlq.validation;

/**
 * One code per way the 7-stage SQL validation pipeline can refuse to run a query.
 *
 * <p>The API must be able to tell the caller WHY their query was refused without leaking
 * internals (raw SQL, table names outside their allowlist, stack traces). 12-09's frontend maps
 * each of these to a user-facing message.
 */
public enum RejectionCode {
    /** Not a single, whitelisted SELECT/WITH statement (DDL, DML, multi-statement, oversized). */
    SHAPE_INVALID,
    /** JSqlParser could not parse the statement (or the parse timed out). */
    PARSE_FAILED,
    /** A referenced table is not in the caller's role-scoped allowlist. */
    TABLE_NOT_ALLOWED,
    /** A selected (or star-expanded) column is on the PII deny-list for its table. */
    PII_COLUMN_DENIED,
    /** The tenant_id predicate could not be injected AND proven present by re-parse. */
    TENANT_FILTER_MISSING,
    /** The branch_id predicate could not be injected AND proven present by re-parse (non-OWNER only). */
    BRANCH_FILTER_MISSING,
    /** LIMIT is missing (handled by injection, not rejection) is fine; a non-numeric/negative/zero LIMIT is not. */
    LIMIT_INVALID
}
