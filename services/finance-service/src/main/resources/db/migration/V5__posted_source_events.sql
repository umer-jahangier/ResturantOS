-- Posted source events: business-level idempotency for auto-posting (FIN-03).
-- NON-RLS — finance internal bookkeeping.

CREATE TABLE posted_source_events (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id    UUID         NOT NULL,
    source_type  VARCHAR(50)  NOT NULL,
    source_id    UUID         NOT NULL,
    je_id        UUID         NOT NULL REFERENCES journal_entries(id),
    posted_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, source_type, source_id)
);

CREATE INDEX idx_posted_source_events_tenant ON posted_source_events (tenant_id);

GRANT SELECT, INSERT ON posted_source_events TO finance_user;
