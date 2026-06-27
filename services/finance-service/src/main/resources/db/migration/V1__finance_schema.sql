-- ============================================================
-- Finance Service - V1 Schema Migration
-- Creates: chart_of_accounts, accounting_periods, je_sequences,
--          journal_entries, journal_lines + RLS + triggers
-- ============================================================

-- ── chart_of_accounts ──────────────────────────────────────
CREATE TABLE chart_of_accounts (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id    UUID    NOT NULL,
    code         VARCHAR(20)  NOT NULL,
    name         VARCHAR(120) NOT NULL,
    account_type VARCHAR(20)  NOT NULL
        CHECK (account_type IN ('ASSET','LIABILITY','EQUITY','REVENUE','COGS','EXPENSE')),
    parent_code  VARCHAR(20),
    system       BOOLEAN      NOT NULL DEFAULT FALSE,
    system_tag   VARCHAR(60),
    active       BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
    created_by   UUID,
    updated_by   UUID,
    deleted_at   TIMESTAMPTZ,
    CONSTRAINT uq_coa_tenant_code UNIQUE (tenant_id, code)
);

ALTER TABLE chart_of_accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON chart_of_accounts
    USING (tenant_id = current_setting('app.current_tenant_id', TRUE)::UUID);

-- ── accounting_periods ──────────────────────────────────────
CREATE TABLE accounting_periods (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID    NOT NULL,
    fiscal_year INT     NOT NULL,
    period_no   INT     NOT NULL CHECK (period_no BETWEEN 1 AND 12),
    start_date  DATE    NOT NULL,
    end_date    DATE    NOT NULL,
    status      VARCHAR(10) NOT NULL DEFAULT 'OPEN'
        CHECK (status IN ('OPEN','LOCKED')),
    locked_by   UUID,
    locked_at   TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by  UUID,
    updated_by  UUID,
    deleted_at  TIMESTAMPTZ,
    CONSTRAINT uq_period_tenant_fy_no UNIQUE (tenant_id, fiscal_year, period_no)
);

ALTER TABLE accounting_periods ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON accounting_periods
    USING (tenant_id = current_setting('app.current_tenant_id', TRUE)::UUID);

-- ── je_sequences ────────────────────────────────────────────
CREATE TABLE je_sequences (
    tenant_id   UUID NOT NULL,
    fiscal_year INT  NOT NULL,
    last_seq    INT  NOT NULL DEFAULT 0,
    PRIMARY KEY (tenant_id, fiscal_year)
);

ALTER TABLE je_sequences ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON je_sequences
    USING (tenant_id = current_setting('app.current_tenant_id', TRUE)::UUID);

-- ── journal_entries ─────────────────────────────────────────
CREATE TABLE journal_entries (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID        NOT NULL,
    branch_id       UUID,
    entry_no        VARCHAR(30),
    period_id       UUID        NOT NULL REFERENCES accounting_periods(id),
    entry_date      DATE        NOT NULL,
    description     VARCHAR(500),
    source_type     VARCHAR(50),
    source_id       UUID,
    status          VARCHAR(10) NOT NULL DEFAULT 'DRAFT'
        CHECK (status IN ('DRAFT','POSTED')),
    posted_by       UUID,
    reversal        BOOLEAN     NOT NULL DEFAULT FALSE,
    reversal_of_je  UUID,
    reversed_by_je  UUID,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by      UUID,
    updated_by      UUID,
    deleted_at      TIMESTAMPTZ
);

ALTER TABLE journal_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON journal_entries
    USING (tenant_id = current_setting('app.current_tenant_id', TRUE)::UUID);

CREATE INDEX idx_je_tenant_period  ON journal_entries (tenant_id, period_id);
CREATE INDEX idx_je_tenant_date    ON journal_entries (tenant_id, entry_date);

-- ── journal_lines ────────────────────────────────────────────
CREATE TABLE journal_lines (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id    UUID NOT NULL,
    je_id        UUID NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
    account_code VARCHAR(20) NOT NULL,
    description  VARCHAR(500),
    debit_paisa  BIGINT NOT NULL DEFAULT 0 CHECK (debit_paisa  >= 0),
    credit_paisa BIGINT NOT NULL DEFAULT 0 CHECK (credit_paisa >= 0),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by   UUID,
    updated_by   UUID,
    deleted_at   TIMESTAMPTZ
);

ALTER TABLE journal_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON journal_lines
    USING (tenant_id = current_setting('app.current_tenant_id', TRUE)::UUID);

CREATE INDEX idx_jl_je_id           ON journal_lines (je_id);
CREATE INDEX idx_jl_tenant_account  ON journal_lines (tenant_id, account_code);

-- ── indexes for period lookups ──────────────────────────────
CREATE INDEX idx_period_tenant_fy ON accounting_periods (tenant_id, fiscal_year);

-- ============================================================
-- TRIGGER 1: Deferred balance check (DEFERRABLE INITIALLY DEFERRED)
-- Fires at transaction COMMIT — allows inserting lines within txn.
-- ============================================================
CREATE OR REPLACE FUNCTION fn_check_je_balance()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
    v_dr BIGINT;
    v_cr BIGINT;
BEGIN
    SELECT COALESCE(SUM(debit_paisa), 0), COALESCE(SUM(credit_paisa), 0)
    INTO v_dr, v_cr
    FROM journal_lines
    WHERE je_id = NEW.je_id;

    IF v_dr <> v_cr THEN
        RAISE EXCEPTION 'JE_UNBALANCED: entry % DR=% CR=%', NEW.je_id, v_dr, v_cr;
    END IF;
    RETURN NEW;
END;
$$;

CREATE CONSTRAINT TRIGGER trg_je_balance
    AFTER INSERT OR UPDATE ON journal_lines
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION fn_check_je_balance();

-- ============================================================
-- TRIGGER 2: Immutability — block UPDATE/DELETE on POSTED journal_entries
-- Exception: setting reversed_by_je on a POSTED JE is allowed.
-- ============================================================
CREATE OR REPLACE FUNCTION fn_protect_posted_je()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    IF OLD.status = 'POSTED' THEN
        -- Allow ONLY the reversal link-back update (reversed_by_je set, status unchanged)
        IF TG_OP = 'UPDATE'
           AND OLD.reversed_by_je IS NULL
           AND NEW.reversed_by_je IS NOT NULL
           AND OLD.status = NEW.status THEN
            RETURN NEW;
        END IF;
        RAISE EXCEPTION 'JE_IMMUTABLE: cannot modify POSTED entry %', OLD.id;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_je_immutable
    BEFORE UPDATE OR DELETE ON journal_entries
    FOR EACH ROW EXECUTE FUNCTION fn_protect_posted_je();

-- ============================================================
-- TRIGGER 3: Immutability — block UPDATE/DELETE on lines of POSTED JE
-- ============================================================
CREATE OR REPLACE FUNCTION fn_protect_posted_je_line()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
    v_status TEXT;
BEGIN
    SELECT status INTO v_status FROM journal_entries WHERE id = OLD.je_id;
    IF v_status = 'POSTED' THEN
        RAISE EXCEPTION 'JE_LINE_IMMUTABLE: cannot modify lines of POSTED entry %', OLD.je_id;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_je_line_immutable
    BEFORE UPDATE OR DELETE ON journal_lines
    FOR EACH ROW EXECUTE FUNCTION fn_protect_posted_je_line();
