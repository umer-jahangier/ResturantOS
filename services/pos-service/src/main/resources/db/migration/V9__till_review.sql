ALTER TABLE till_sessions
    ADD COLUMN note TEXT,
    ADD COLUMN review_status VARCHAR(20) NOT NULL DEFAULT 'PENDING_REVIEW';

CREATE TABLE till_review_actions (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id        UUID NOT NULL,
    till_session_id  UUID NOT NULL REFERENCES till_sessions(id),
    reviewer_id      UUID NOT NULL,
    action           VARCHAR(20) NOT NULL,
    note             TEXT,
    acted_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by       UUID,
    updated_by       UUID,
    deleted_at       TIMESTAMPTZ
);

ALTER TABLE till_review_actions ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON till_review_actions
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', TRUE), '')::UUID);

CREATE INDEX idx_till_review_actions_till ON till_review_actions (till_session_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON till_review_actions TO pos_user;
