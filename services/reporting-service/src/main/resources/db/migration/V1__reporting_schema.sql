-- reporting-service V1: shared infra tables required by shared-lib (OutboxEntry, IdempotencyService,
-- ProcessedEventEntity) plus report_run_log (RPT-01's P95-latency evidence table).
--
-- event_outbox / idempotency_keys / processed_events are NON-RLS per Doc 8 §8.9 — the relay,
-- request-idempotency guard and event-dedup guard all run outside tenant request context. This
-- mirrors kitchen-service's V2__kitchen_infra_tables.sql and purchasing-service's
-- V4__shared_infra_tables.sql verbatim (processed_events has NO tenant_id column — consumer +
-- event_id is its whole identity — so RLS cannot apply to it; see 12-03-SUMMARY.md for why this
-- diverges from the plan's context-block prose, which sketched a tenant_id column on this table).
--
-- report_run_log IS tenant-scoped real business data (which tenant/branch ran which report, how
-- long it took, how many rows) so it gets RLS ENABLE + FORCE + the standard tenant_isolation
-- policy, copied verbatim from purchasing-service's V1__purchasing_schema.sql pattern. The GUC name
-- is `app.current_tenant_id` (verified against shared-lib's TenantAwareDataSource and every other
-- service's migration — NOT `app.tenant_id`, which does not exist anywhere in this codebase).

CREATE TABLE event_outbox (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id        UUID        NOT NULL,
    exchange        TEXT        NOT NULL,
    routing_key     TEXT        NOT NULL,
    event_type      TEXT        NOT NULL,
    tenant_id       UUID        NOT NULL,
    branch_id       UUID,
    correlation_id  UUID        NOT NULL,
    source          TEXT        NOT NULL,
    envelope_json   TEXT        NOT NULL,
    status          TEXT        NOT NULL DEFAULT 'PENDING',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    sent_at         TIMESTAMPTZ
);

CREATE INDEX idx_reporting_event_outbox_status_created ON event_outbox (status, created_at);

GRANT SELECT, INSERT, UPDATE, DELETE ON event_outbox TO reporting_user;

CREATE TABLE idempotency_keys (
    idem_key       VARCHAR(200) PRIMARY KEY,
    request_hash   VARCHAR(64)  NOT NULL,
    status         VARCHAR(20)  NOT NULL,
    response_json  TEXT,
    created_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
    expires_at     TIMESTAMPTZ  NOT NULL
);

CREATE INDEX idx_reporting_idempotency_expires_at ON idempotency_keys (expires_at);

GRANT SELECT, INSERT, UPDATE, DELETE ON idempotency_keys TO reporting_user;

-- Idempotency guard for the ETL consumers (OrderClosedConsumer / TillClosedConsumer /
-- VendorInvoiceMatchedConsumer). PRIMARY KEY (consumer, event_id) makes dedup per-consumer, not
-- global — a redelivered ORDER_CLOSED cannot collide with a coincidentally-equal eventId from a
-- different consumer.
CREATE TABLE processed_events (
    consumer      TEXT        NOT NULL,
    event_id      UUID        NOT NULL,
    source_type   TEXT,
    source_id     UUID,
    processed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (consumer, event_id)
);

GRANT SELECT, INSERT ON processed_events TO reporting_user;

-- report_run_log — the P95 latency evidence table for RPT-01 (12-05 populates it on every named
-- report execution; 12-06/12-07 will too). Tenant-scoped, RLS-protected real business data.
CREATE TABLE report_run_log (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id    UUID NOT NULL,
    branch_id    UUID,
    report_code  VARCHAR(100) NOT NULL,
    params       JSONB,
    row_count    INT,
    duration_ms  INT,
    run_by       UUID,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_report_run_log_tenant_report_created
    ON report_run_log (tenant_id, report_code, created_at);

ALTER TABLE report_run_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE report_run_log FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON report_run_log
    USING (tenant_id = current_setting('app.current_tenant_id', TRUE)::UUID);

GRANT SELECT, INSERT, UPDATE, DELETE ON report_run_log TO reporting_user;
