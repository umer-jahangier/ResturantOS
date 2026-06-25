---
status: testing
phase: 01-infrastructure-foundation-shared-library
source:
  - 01-01-SUMMARY.md
  - 01-02-SUMMARY.md
  - 01-03-SUMMARY.md
  - 01-04-SUMMARY.md
started: 2026-06-23T02:05:00+05:00
updated: 2026-06-23T02:25:00+05:00
---

## Current Test

number: 3
name: Full stack bring-up
expected: |
  Run `make dev-up` from repo root. All infrastructure containers start and reach healthy status (`make dev-ps` shows healthy for postgres, redis, rabbitmq, minio, opa, eureka, config-server, clickhouse, pgadmin, mailpit).
awaiting: user response

## Tests

### 1. JDK 25 + Maven compile
expected: OpenJDK 25 active; Maven reactor (shared-lib, eureka-server, config-server) compiles successfully
result: pass
note: User updated ~/.zshrc to openjdk@25, uninstalled openjdk@21. Maven BUILD SUCCESS confirmed earlier.

### 2. Dev secrets generation
expected: Run `bash deploy/generate-keys.sh` from repo root. It prints a non-secret confirmation, creates/updates `deploy/.env` with exactly one line each for JWT_PRIVATE_KEY, JWT_PUBLIC_KEY, and FIELD_ENCRYPTION_KEY. Running it twice does not duplicate lines.
result: pass
note: Verified — each key line count stays 1 after two runs; script prints non-secret confirmation only.

### 3. Full stack bring-up
expected: Run `make dev-up` from repo root. All infrastructure containers start and reach healthy status (`make dev-ps` shows healthy for postgres, redis, rabbitmq, minio, opa, eureka, config-server, clickhouse, pgadmin, mailpit).
result: pending

### 4. PostgreSQL databases and roles
expected: After stack is up, `docker exec restaurantos-postgres psql -U postgres -c '\l'` lists all 13 service databases. `docker exec restaurantos-postgres psql -U postgres -c '\du'` shows 13 `*_user` roles without Superuser or Bypass RLS attributes.
result: pending

### 5. RabbitMQ topology
expected: After stack is up, RabbitMQ has 9 topic exchanges (pos.topic through notifications.topic) plus restaurantos.dlx; consumer queues each have a `.dlq` sibling; audit.all-events.queue is bound to all 9 topic exchanges with routing key `#`. Visible in management UI at http://localhost:15672 or via `rabbitmqctl list_exchanges`.
result: pending

### 6. OPA policy load
expected: OPA container is healthy and loads `restaurantos.common` policy from the mounted policies directory (e.g. `curl -s http://localhost:8181/v1/policies` includes restaurantos).
result: pending

### 7. shared-lib integration tests
expected: With Docker running, `mvn -pl shared-lib -am verify` completes GREEN — SharedLibVerificationIT passes (tenant propagation, MoneyUtils, outbox relay, RLS guard).
result: pending

## Summary

total: 7
passed: 2
issues: 0
pending: 5
skipped: 0

## Gaps

[none yet]
