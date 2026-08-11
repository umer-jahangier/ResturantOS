-- ============================================================================
-- 28-04 — POS terminal profiles: the "dedicated POS selecting the respective menu"
-- ============================================================================
-- The user asked for this by name. There is no terminal entity in this codebase today —
-- `orders` knows a cashier and a till session and has no notion of WHICH physical POS took
-- the order, and a POS screen shows the whole menu regardless of whether it is the bar or
-- the counter. D-28-03 makes a terminal a first-class profile: a name, a code, a branch,
-- the stations it fires to, and the menu categories it offers.
--
-- ══ EMPTY MEANS EVERYTHING, AND THERE IS NO FLAG ══
--
-- A terminal with NO rows in `pos_terminal_categories` offers the WHOLE menu. A terminal
-- with NO rows in `pos_terminal_stations` fires to EVERY station. That is not a shortcut —
-- it is the only encoding under which a tenant who never opens this screen keeps today's
-- behaviour exactly, and today's behaviour is one POS showing everything.
--
-- There is deliberately NO `serves_all` boolean, and none may be added. A flag and the row
-- set it summarises can disagree, and on the day they do, one of them is wrong and no
-- reader can tell which. If you are here because "empty" felt ambiguous: it is not
-- ambiguous, it is the documented default, and the alternative is two sources of truth.
--
-- ══ THE CATEGORY SCOPE IS A FILTER, NOT AN AUTHORIZATION BOUNDARY ══
--
-- The server does NOT refuse an add-item for a category a terminal does not list, and no
-- code reads these rows to make an authorization decision. This is stated here because a
-- half-enforced guard is worse than a declared filter: phase 13-16 found exactly that shape
-- in createOrder, where a check only fired when a user id happened to be present and
-- therefore established nothing it appeared to. If a hard boundary is ever wanted, it
-- belongs in the policy engine with its own rules and its own tests.
--
-- ══ DEACTIVATE, NEVER DELETE ══
--
-- No hard delete is offered and there is no DELETE endpoint. From plan 28-12 onward
-- `orders.terminal_id` references these rows, and a closed order must keep naming the
-- terminal it was taken on. Same posture as dining_tables (V12) and stations (V7).
--
-- ══ WHAT IS DELIBERATELY NOT HERE ══
--
-- No `requires_till` column. Phase 13-16 settled where the cash-till invariant lives, and a
-- per-terminal override is a money change that needs its own phase (D-28-06); an unwired
-- column would be decoration that a later reader mistakes for a decision.
-- No `till_sessions` change of any kind. No order attribution — that is plan 28-12.
--
-- ══ ROW LEVEL SECURITY ══
--
-- All three tables get a tenant_isolation policy, then ENABLE, then FORCE — in that order,
-- in this migration, not deferred to a later sweep. PostgreSQL exempts a table's OWNER from
-- its own policies without FORCE, and pos-service connects as the owner. That exemption is
-- what made 16 tenants' rows mutually readable before V11. RlsForcedInvariantIT fails the
-- build for any RLS-enabled table that is not also FORCEd, and if it fails here the
-- migration is wrong, not the test.
-- ============================================================================

-- ── pos_terminals ───────────────────────────────────────────────────────────
CREATE TABLE pos_terminals (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id          UUID         NOT NULL,
    branch_id          UUID         NOT NULL,
    code               VARCHAR(50)  NOT NULL,
    name               VARCHAR(100) NOT NULL,
    service_model      VARCHAR(20)  NOT NULL DEFAULT 'COUNTER',
    -- Optional. When set, the POS pre-selects this order type; the operator can still change
    -- it. Reuses the existing OrderType enum rather than declaring a parallel one.
    default_order_type VARCHAR(20),
    -- An OPAQUE handle, deliberately. Thermal printing is owned by phase 26 and it decides the
    -- identifier scheme; modelling an address or a model name here would either duplicate that
    -- decision or contradict it. One nullable string is the correct amount of coupling.
    printer_ref        VARCHAR(200),
    is_active          BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at         TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ  NOT NULL DEFAULT now(),
    created_by         UUID,
    updated_by         UUID,
    deleted_at         TIMESTAMPTZ,
    -- Mirrors uq_station_tenant_branch_code: a code is unique WITHIN a branch, so two branches
    -- of the same tenant may both have a "COUNTER-1" and neither has to invent a prefix.
    CONSTRAINT uq_pos_terminal_tenant_branch_code UNIQUE (tenant_id, branch_id, code),
    CONSTRAINT ck_pos_terminal_service_model
        CHECK (service_model IN ('COUNTER', 'TABLE_SERVICE', 'SELF_SERVE')),
    CONSTRAINT ck_pos_terminal_default_order_type
        CHECK (default_order_type IS NULL
               OR default_order_type IN ('DINE_IN', 'TAKEAWAY', 'DELIVERY', 'PICKUP'))
);

CREATE INDEX idx_pos_terminals_branch ON pos_terminals (tenant_id, branch_id);

ALTER TABLE pos_terminals ENABLE ROW LEVEL SECURITY;
ALTER TABLE pos_terminals FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON pos_terminals
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', TRUE), '')::UUID);
GRANT SELECT, INSERT, UPDATE, DELETE ON pos_terminals TO pos_user;

-- ── pos_terminal_categories ─────────────────────────────────────────────────
-- Which menu categories this terminal OFFERS. NO ROWS = offers every category.
-- Do not add a flag to say so. See the header.
CREATE TABLE pos_terminal_categories (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID        NOT NULL,
    terminal_id UUID        NOT NULL REFERENCES pos_terminals(id) ON DELETE CASCADE,
    category_id UUID        NOT NULL REFERENCES menu_categories(id),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by  UUID,
    updated_by  UUID,
    deleted_at  TIMESTAMPTZ,
    CONSTRAINT uq_pos_terminal_category UNIQUE (terminal_id, category_id)
);

CREATE INDEX idx_pos_terminal_categories_terminal ON pos_terminal_categories (tenant_id, terminal_id);

ALTER TABLE pos_terminal_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE pos_terminal_categories FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON pos_terminal_categories
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', TRUE), '')::UUID);
GRANT SELECT, INSERT, UPDATE, DELETE ON pos_terminal_categories TO pos_user;

-- ── pos_terminal_stations ───────────────────────────────────────────────────
-- Which stations this terminal FIRES TO. NO ROWS = fires to every station.
CREATE TABLE pos_terminal_stations (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID        NOT NULL,
    terminal_id UUID        NOT NULL REFERENCES pos_terminals(id) ON DELETE CASCADE,
    station_id  UUID        NOT NULL REFERENCES stations(id),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by  UUID,
    updated_by  UUID,
    deleted_at  TIMESTAMPTZ,
    CONSTRAINT uq_pos_terminal_station UNIQUE (terminal_id, station_id)
);

CREATE INDEX idx_pos_terminal_stations_terminal ON pos_terminal_stations (tenant_id, terminal_id);

ALTER TABLE pos_terminal_stations ENABLE ROW LEVEL SECURITY;
ALTER TABLE pos_terminal_stations FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON pos_terminal_stations
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', TRUE), '')::UUID);
GRANT SELECT, INSERT, UPDATE, DELETE ON pos_terminal_stations TO pos_user;
