-- Shared infrastructure tables required by shared-lib (OutboxEntry, IdempotencyService, processed_events).
-- NON-RLS per Doc 8 A8.9 — relay and idempotency run outside tenant request context.

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

CREATE INDEX idx_kitchen_event_outbox_status_created ON event_outbox (status, created_at);

GRANT SELECT, INSERT, UPDATE, DELETE ON event_outbox TO kitchen_user;

CREATE TABLE idempotency_keys (
    idem_key       VARCHAR(200) PRIMARY KEY,
    request_hash   VARCHAR(64)  NOT NULL,
    status         VARCHAR(20)  NOT NULL,
    response_json  TEXT,
    created_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
    expires_at     TIMESTAMPTZ  NOT NULL
);

CREATE INDEX idx_kitchen_idempotency_expires_at ON idempotency_keys (expires_at);

GRANT SELECT, INSERT, UPDATE, DELETE ON idempotency_keys TO kitchen_user;

CREATE TABLE processed_events (
    consumer      TEXT        NOT NULL,
    event_id      UUID        NOT NULL,
    source_type   TEXT,
    source_id     UUID,
    processed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (consumer, event_id)
);

GRANT SELECT, INSERT ON processed_events TO kitchen_user;
