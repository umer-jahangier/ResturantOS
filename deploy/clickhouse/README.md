# deploy/clickhouse/

Analytics schema DDL and the locked-down `nlq_readonly` user for the `clickhouse_analytics`
database, applied against the ClickHouse 25.9 container provisioned by
`deploy/docker-compose.yml`.

## Usage

```bash
docker compose -f deploy/docker-compose.yml up -d clickhouse
./deploy/clickhouse/apply.sh
```

Run this **after** the `clickhouse` container is up and **before** booting reporting-service or
nlq-service — both depend on `clickhouse_analytics`'s fact tables existing, and nlq-service
additionally depends on the `nlq_readonly` user. reporting-service fails fast at startup if the
fact tables are missing (see 12-03).

Required environment (sourced from `deploy/.env` if present):

| Var | Default | Notes |
|---|---|---|
| `CLICKHOUSE_URL` | `http://localhost:8123` | HTTP interface |
| `CLICKHOUSE_USER` | `default` | admin user used to run DDL |
| `CLICKHOUSE_PASSWORD` | (none — required) | must match the running container |
| `CLICKHOUSE_READONLY_PASSWORD` | (none — required) | `apply.sh` refuses to run without it; never creates a passwordless `nlq_readonly` user |

## File naming convention

Files are applied in lexical order, one migration per file:

- `V001__analytics_facts.sql` — the four fact tables (`sales_order_facts`, `sales_item_facts`,
  `purchase_tax_facts`, `till_session_facts`).
- `V002__nlq_readonly_user.sql` — the `nlq_readonly_profile` settings profile, the `nlq_readonly`
  user, and its per-table `SELECT` grants.
- Future migrations: `V003__...sql`, `V004__...sql`, etc — same `V<NNN>__description.sql`
  pattern, always `CREATE ... IF NOT EXISTS` / `CREATE OR REPLACE` so the whole directory stays
  re-runnable end to end.

`zz-access-management.xml` is not a migration — it's a ClickHouse `users.d/` config override that
`apply.sh` `docker cp`s into the running container (and restarts it) to enable SQL-driven access
control, which the stock `clickhouse/clickhouse-server:25.9` image ships disabled for the default
user. See the comment header in that file and in `V002__nlq_readonly_user.sql` for the full
empirical finding.

## Relationship to `deploy/init/clickhouse-init.sql`

`deploy/init/clickhouse-init.sql` (owned by the Docker Compose / infra plan) only runs once, at
container first-boot, and only creates the empty `clickhouse_analytics` database — it is
intentionally minimal ("full schema added by reporting-service migrations", per its own comment).
**This directory (`deploy/clickhouse/`) owns the actual schema** — all tables, users, profiles,
and grants — and is safe to re-run on every deploy, unlike the init script.
