---
phase: 01-infrastructure-foundation-shared-library
plan: 03
subsystem: messaging-backbone
tags: [rabbitmq, amqp, topology, dlq, jwt, aes256, secrets, env]

dependency-graph:
  requires: ["01-01"]
  provides:
    - "Full RabbitMQ topic exchange + DLQ topology loaded at boot (rabbitmq-definitions.json)"
    - "rabbitmq.conf bind-mount source enabling load_definitions"
    - "Idempotent key-generation script producing RS256 PEM keypair + AES-256 key into deploy/.env"
    - "deploy/.env.example enumerating every agent-spec 05 variable with dev defaults"
  affects: ["01-04", "02-*", "03-*"]

tech-stack:
  added: []
  patterns:
    - "RabbitMQ definitions.json pre-load for zero-config topology at boot"
    - "Single-line base64-of-PEM for .env KEY=VALUE compatibility"
    - "Idempotent sed-based key rotation in bash"

key-files:
  created:
    - deploy/init/rabbitmq.conf
    - deploy/init/rabbitmq-definitions.json
    - deploy/generate-keys.sh
    - deploy/.env.example
  modified: []

decisions:
  - id: "01-03-D1"
    decision: "Skip user/permissions in rabbitmq-definitions.json; let RABBITMQ_DEFAULT_USER/PASS env vars create the user automatically"
    rationale: "Including password_hash in definitions.json overrides the env-var user; omitting user block keeps dev workflow simple and avoids exposing credentials in a committed file"
  - id: "01-03-D2"
    decision: "Encode PEM as base64 (not \\n-escaped) for .env storage"
    rationale: "Base64-of-PEM is a single opaque string that survives all .env parsers; consumers (JwksKeyProvider / JwtProperties from 01-04) Base64-decode the value then parse the resulting PEM"
  - id: "01-03-D3"
    decision: "Use portable sed (GNU -i vs macOS -i ''') pattern with version detection"
    rationale: "avoids GNU-only flag; script runs on macOS dev machines and Linux CI without modification"

metrics:
  duration: "~3 minutes"
  completed: "2026-06-23"
---

# Phase 01 Plan 03: RabbitMQ Topology, Key Generation, .env.example Summary

**One-liner:** Full RabbitMQ §2.2 topology loaded at boot via definitions.json (9 topic exchanges + DLX + per-queue DLQs), idempotent RS256+AES-256 key generator, and complete .env.example from agent-spec 05.

## What Was Built

### Task 1 — deploy/init/rabbitmq.conf + deploy/init/rabbitmq-definitions.json (commit `3059138`)

`rabbitmq.conf` contains a single line that points RabbitMQ to the definitions file:
```
load_definitions = /etc/rabbitmq/definitions.json
```
This file is the bind-mount source for the `./init/rabbitmq.conf:/etc/rabbitmq/rabbitmq.conf:ro` volume declared in the docker-compose.yml from 01-01. Without it on disk, Docker would silently create a directory breaking RabbitMQ startup.

`rabbitmq-definitions.json` declares the complete §2.2 topology:
- **10 exchanges**: 9 topic exchanges (`pos`, `inventory`, `finance`, `purchasing`, `hr`, `auth`, `platform`, `kitchen`, `notifications.topic`) + `restaurantos.dlx` (direct, dead-letter)
- **20 queues**: 10 durable consumer queues each with `x-dead-letter-exchange` and `x-dead-letter-routing-key` arguments, plus 10 `.dlq` sibling queues
- **Bindings**: 9 regular queue-to-exchange bindings, 9 fan-out bindings from every topic exchange to `audit.all-events.queue` (routing key `#`), and 10 DLQ bindings to `restaurantos.dlx`
- No `users`/`permissions` blocks — RabbitMQ creates the user from `RABBITMQ_DEFAULT_USER/PASS` env vars, which automatically gets `/` vhost access

### Task 2 — deploy/generate-keys.sh (commit `4f6632d`)

Idempotent bash script that:
1. Copies `.env.example` → `.env` on first run if `.env` is absent
2. Generates RSA-2048 private key via `openssl genpkey`, derives public key via `openssl rsa`
3. Base64-encodes both PEMs (inline with `tr -d '\n'`) for single-line .env storage
4. Generates a 32-byte AES-256 key via `openssl rand -base64 32`
5. Deletes existing `JWT_PRIVATE_KEY=`, `JWT_PUBLIC_KEY=`, `FIELD_ENCRYPTION_KEY=` lines then appends fresh values (idempotent rotation)
6. Uses portable `sed` detection (GNU `-i` vs macOS `-i ''`)
7. Never prints secrets to stdout; outputs only "Wrote 3 keys to deploy/.env"

### Task 3 — deploy/.env.example (commit `fe36e40`)

Complete transcription of agent-spec 05 §5.2 with all variables:
- 13 `*_DB_PASSWORD` vars (matching `02-create-roles.sql` names exactly)
- Infrastructure: `POSTGRES_*`, `REDIS_*`, `RABBITMQ_*`, `MINIO_*`, `OPA_URL`, `CLICKHOUSE_*`
- Service mesh: `EUREKA_URL`, `CONFIG_SERVER_URL`
- Secrets (placeholder): `JWT_PRIVATE_KEY`, `JWT_PUBLIC_KEY`, `FIELD_ENCRYPTION_KEY`
- Application: Anthropic, SMTP, observability, business config, gateway rate limits
- Frontend: `NEXT_PUBLIC_*` vars
- Dev tooling: pgAdmin vars

## Decisions Made

| ID | Decision | Rationale |
|----|----------|-----------|
| 01-03-D1 | Omit `users`/`permissions` from definitions.json | Avoids password_hash override of env-var user; simpler dev flow |
| 01-03-D2 | Base64-encode PEM (not `\n`-escaped) for .env | Single opaque string; survives all .env parsers |
| 01-03-D3 | Portable `sed` with GNU/macOS detection | Script runs unchanged on dev Macs and Linux CI |

## Deviations from Plan

None — plan executed exactly as written.

## Verification Results

- `deploy/init/rabbitmq.conf` exists and contains `load_definitions = /etc/rabbitmq/definitions.json`
- `python3 -c "import json;json.load(open('deploy/init/rabbitmq-definitions.json'))"` passes
- Exchange array: exactly 9 topic exchanges (`notifications.topic` plural, no `crm.topic`) + `restaurantos.dlx`
- `bash deploy/generate-keys.sh` exits 0, prints non-secret confirmation, writes 1 line each for JWT_PRIVATE_KEY / JWT_PUBLIC_KEY / FIELD_ENCRYPTION_KEY
- Running script twice produces exactly 1 line per key (idempotent)
- `FIELD_ENCRYPTION_KEY` decoded → 32 bytes (AES-256)
- `deploy/.env` is gitignored; `deploy/.env.example` is committed

## Next Phase Readiness

- **01-04** (shared-lib JWT classes) can proceed: `JwksKeyProvider` and `JwtProperties` will Base64-decode `JWT_PRIVATE_KEY`/`JWT_PUBLIC_KEY` from the generated `.env`
- **`make dev-up`** RabbitMQ blocker resolved: `rabbitmq.conf` (bind-mount source) exists; `rabbitmq-definitions.json` loads full topology on startup
- `deploy/.env` is still absent from the repo but generated locally by `bash deploy/generate-keys.sh`
