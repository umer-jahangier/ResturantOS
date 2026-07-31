-- Shared §8.9 infra tables (event_outbox / idempotency_keys / processed_events), NON-RLS.
-- nlq-service scans io.restaurantos.shared for entities, so shared-lib's outbox relay and
-- idempotency machinery are auto-configured and expect these tables to exist — without them the
-- context boots but the relay poller fails with `relation "event_outbox" does not exist`.
-- Mirrors reporting-service's V1 shared-table block verbatim (which mirrors auth-service's
-- V4__shared_infra_tables.sql), retargeted to nlq_user. nlq-service publishes/consumes no events
-- today, but the tables must exist for the shared auto-config to start cleanly.

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

CREATE INDEX idx_nlq_event_outbox_status_created ON event_outbox (status, created_at);

GRANT SELECT, INSERT, UPDATE, DELETE ON event_outbox TO nlq_user;

CREATE TABLE idempotency_keys (
    idem_key       VARCHAR(200) PRIMARY KEY,
    request_hash   VARCHAR(64)  NOT NULL,
    status         VARCHAR(20)  NOT NULL,
    response_json  TEXT,
    created_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
    expires_at     TIMESTAMPTZ  NOT NULL
);

CREATE INDEX idx_nlq_idempotency_expires_at ON idempotency_keys (expires_at);

GRANT SELECT, INSERT, UPDATE, DELETE ON idempotency_keys TO nlq_user;

CREATE TABLE processed_events (
    consumer      TEXT        NOT NULL,
    event_id      UUID        NOT NULL,
    source_type   TEXT,
    source_id     UUID,
    processed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (consumer, event_id)
);

GRANT SELECT, INSERT ON processed_events TO nlq_user;
