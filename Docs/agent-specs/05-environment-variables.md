# RestaurantOS — Document 5: Environment Variables Reference

> Every variable every service and infrastructure component requires. No agent hardcodes a value or guesses a name. Secrets are stored in Vault (prod) / `.env` (dev). `Secret=Yes` means never commit a real value and never log it.

## 5.1 Master Variable Table

| Variable | Service(s) | Type | Default (dev) | Req in Prod | Secret | Description | Example |
|---|---|---|---|---|---|---|---|
| `SERVER_PORT` | each service | int | per service | Yes | No | HTTP port | `8084` |
| `SPRING_PROFILES_ACTIVE` | all Java | string | `dev` | Yes | No | active profile | `prod` |
| `DB_HOST` | all Java w/ DB | string | `localhost` | Yes | No | Postgres host | `postgres` |
| `DB_PORT` | all Java w/ DB | int | `5432` | Yes | No | Postgres port | `5432` |
| `DB_NAME` | per service | string | per service | Yes | No | service database | `pos_db` |
| `DB_URL` | all Java w/ DB | string | derived | Yes | No | full JDBC URL | `jdbc:postgresql://postgres:5432/pos_db` |
| `DB_USERNAME` | per service | string | per service | Yes | Yes | service DB user | `pos_user` |
| `DB_PASSWORD` | per service | string | — | Yes | Yes | service DB password | `your-db-password` |
| `REDIS_HOST` | most services, gateway | string | `localhost` | Yes | No | Redis host | `redis` |
| `REDIS_PORT` | most services | int | `6379` | Yes | No | Redis port | `6379` |
| `REDIS_PASSWORD` | most services | string | — | Yes | Yes | Redis auth | `your-redis-password` |
| `REDIS_URL` | most services | string | derived | Yes | Yes | full Redis URL | `redis://:pass@redis:6379` |
| `RABBITMQ_HOST` | all services | string | `localhost` | Yes | No | broker host | `rabbitmq` |
| `RABBITMQ_PORT` | all services | int | `5672` | Yes | No | AMQP port | `5672` |
| `RABBITMQ_USERNAME` | all services | string | `restaurantos` | Yes | Yes | broker user | `restaurantos` |
| `RABBITMQ_PASSWORD` | all services | string | — | Yes | Yes | broker password | `your-rabbitmq-password` |
| `JWT_PRIVATE_KEY` | auth-service ONLY | string (PEM) | dev key | Yes | Yes | RS256 signing key | `-----BEGIN PRIVATE KEY-----...` |
| `JWT_PUBLIC_KEY_ID` | auth-service | string | `dev-key-1` | Yes | No | JWKS kid | `prod-key-2026` |
| `JWT_JWKS_URL` | all except auth | string | `http://localhost:8081/.well-known/jwks.json` | Yes | No | JWKS endpoint | `http://auth-service:8081/.well-known/jwks.json` |
| `JWT_ACCESS_TTL_SECONDS` | auth-service | int | `900` | Yes | No | access token TTL | `900` |
| `JWT_REFRESH_TTL_SECONDS` | auth-service | int | `604800` | Yes | No | refresh TTL (7d) | `604800` |
| `FIELD_ENCRYPTION_KEY` | auth, hr, purchasing | string (base64) | dev key | Yes | Yes | AES-256-GCM key | `base64-32-byte-key` |
| `ANTHROPIC_API_KEY` | nlq-service | string | — | Yes | Yes | Claude API key | `sk-ant-your-key` |
| `ANTHROPIC_MODEL_SQL` | nlq-service | string | `claude-sonnet-4-20250514` | Yes | No | SQL-gen model | `claude-sonnet-4-20250514` |
| `ANTHROPIC_MODEL_NARRATIVE` | nlq-service | string | `claude-haiku-...` | Yes | No | narrative model | `claude-haiku-4-...` |
| `MINIO_ENDPOINT` | file, hr, notification | string | `http://localhost:9000` | Yes | No | MinIO endpoint | `http://minio:9000` |
| `MINIO_ACCESS_KEY` | file, hr | string | `minioadmin` | Yes | Yes | MinIO access key | `your-minio-access` |
| `MINIO_SECRET_KEY` | file, hr | string | — | Yes | Yes | MinIO secret | `your-minio-secret` |
| `MINIO_BUCKET` | file | string | `restaurantos-dev` | Yes | No | default bucket | `restaurantos-prod` |
| `VAULT_ADDR` | all (prod) | string | — | Yes (prod) | No | Vault address | `https://vault:8200` |
| `VAULT_TOKEN` | all (prod) | string | — | Yes (prod) | Yes | Vault token | `your-vault-token` |
| `SMTP_URL` | notification | string | `smtp://localhost:1025` | Yes | Yes | SMTP connection | `smtp://user:pass@smtp:587` |
| `SMTP_FROM` | notification | string | `noreply@restaurantos.io` | Yes | No | default sender | `noreply@restaurantos.io` |
| `WHATSAPP_API_URL` | notification | string | — | No | No | WhatsApp Business API | `https://graph.facebook.com/v20.0` |
| `WHATSAPP_API_TOKEN` | notification | string | — | No | Yes | WhatsApp token | `your-wa-token` |
| `GLITCHTIP_DSN` | all | string | — | Yes | Yes | error tracking DSN | `https://key@glitchtip/1` |
| `CONFIG_SERVER_URL` | all Java | string | `http://localhost:8888` | Yes | No | Spring Cloud Config | `http://config-server:8888` |
| `CONFIG_GIT_URI` | config-server | string | — | Yes | No | config repo URL | `https://git/restaurantos-config.git` |
| `CONFIG_GIT_USERNAME` | config-server | string | — | Yes | Yes | git user | `config-bot` |
| `CONFIG_GIT_PASSWORD` | config-server | string | — | Yes | Yes | git token | `your-git-token` |
| `EUREKA_URL` | all Java | string | `http://localhost:8761/eureka` | Yes | No | Eureka URL | `http://eureka:8761/eureka` |
| `OPA_URL` | all services + authz | string | `http://localhost:8181` | Yes | No | OPA address | `http://opa:8181` |
| `INTERNAL_SERVICE_SECRET` | all services | string | dev secret | Yes | Yes | `X-Internal-Service` shared secret | `your-internal-secret` |
| `BUSINESS_DAY_OFFSET_HOURS` | pos, finance, reporting | int | `4` | Yes | No | business-day cutoff | `4` |
| `NLQ_MONTHLY_QUOTA_DEFAULT` | nlq, platform | int | `500` | Yes | No | default monthly NLQ cap | `500` |
| `NLQ_USER_HOURLY_LIMIT` | nlq | int | `30` | Yes | No | per-user hourly NLQ cap | `30` |
| `PO_APPROVAL_TIER1_PAISA` | purchasing | long | `5000000` | Yes | No | Tier 1 threshold | `5000000` |
| `PO_APPROVAL_TIER2_PAISA` | purchasing | long | `20000000` | Yes | No | Tier 2 threshold | `20000000` |
| `CLICKHOUSE_URL` | reporting, nlq | string | `http://localhost:8123` | Yes | No | ClickHouse HTTP | `http://clickhouse:8123` |
| `CLICKHOUSE_USER` | reporting | string | `default` | Yes | Yes | CH write user | `reporting_user` |
| `CLICKHOUSE_PASSWORD` | reporting | string | — | Yes | Yes | CH password | `your-ch-password` |
| `CLICKHOUSE_READONLY_USER` | nlq | string | `nlq_readonly` | Yes | Yes | CH read-only user | `nlq_readonly` |
| `CLICKHOUSE_READONLY_PASSWORD` | nlq | string | — | Yes | Yes | CH read-only password | `your-ch-ro-password` |
| `NEXT_PUBLIC_API_BASE_URL` | frontend | string | `http://localhost:8080` | Yes | No | gateway base URL (browser) | `https://api.restaurantos.io` |
| `NEXT_PUBLIC_WS_BASE_URL` | frontend | string | `ws://localhost:8080` | Yes | No | WebSocket base | `wss://api.restaurantos.io` |
| `NEXT_PUBLIC_GLITCHTIP_DSN` | frontend | string | — | Yes | No | frontend error DSN | `https://key@glitchtip/2` |
| `RATE_LIMIT_AUTH_PER_MIN` | gateway | int | `100` | Yes | No | auth route limit/IP | `100` |
| `RATE_LIMIT_API_PER_MIN` | gateway | int | `600` | Yes | No | general route limit/IP | `600` |
| `BACKUP_S3_BUCKET` | backup container | string | — | Yes | No | backup target bucket | `restaurantos-backups` |
| `BACKUP_S3_ACCESS_KEY` | backup container | string | — | Yes | Yes | backup creds | `your-backup-access` |
| `BACKUP_S3_SECRET_KEY` | backup container | string | — | Yes | Yes | backup secret | `your-backup-secret` |
| `PGADMIN_DEFAULT_EMAIL` | pgadmin (dev) | string | `admin@restaurantos.local` | No | No | pgAdmin login | `admin@restaurantos.local` |
| `PGADMIN_DEFAULT_PASSWORD` | pgadmin (dev) | string | `admin` | No | Yes | pgAdmin password | `your-pgadmin-password` |

Per-service `SERVER_PORT`: gateway `8080`(public), platform `8080`/`8096`(dev), auth `8081`, user `8082`, authz `8083`, pos `8084`, inventory `8085`, finance `8086`, purchasing `8087`, hr `8088`, crm `8089`, kitchen `8090`, notification `8091`, reporting `8092`, audit `8093`, nlq `8094`, file `8095`, eureka `8761`, config-server `8888`.

Per-service `DB_NAME`: `platform_db`, `auth_db` (auth + authz), `user_db`, `pos_db`, `inventory_db`, `finance_db`, `purchasing_db`, `hr_db`, `crm_db`, `kitchen_db`, `notification_db`, `audit_db`, `file_db`. Reporting uses ClickHouse, not a Postgres `DB_NAME`.

## 5.2 `.env.example` for Docker Compose Local Development

```bash
# ============================================================================
# RestaurantOS — Local Development Environment (.env.example)
# Copy to .env and fill secrets. NEVER commit a real .env.
# ============================================================================

# --- PostgreSQL (single instance, multiple databases) ---
POSTGRES_SUPERUSER=postgres
POSTGRES_SUPERUSER_PASSWORD=your-postgres-superuser-password
DB_HOST=postgres
DB_PORT=5432

# Per-service DB credentials (created by init/02-create-roles.sql)
AUTH_DB_PASSWORD=your-auth-db-password
USER_DB_PASSWORD=your-user-db-password
POS_DB_PASSWORD=your-pos-db-password
INVENTORY_DB_PASSWORD=your-inventory-db-password
FINANCE_DB_PASSWORD=your-finance-db-password
PURCHASING_DB_PASSWORD=your-purchasing-db-password
HR_DB_PASSWORD=your-hr-db-password
CRM_DB_PASSWORD=your-crm-db-password
KITCHEN_DB_PASSWORD=your-kitchen-db-password
NOTIFICATION_DB_PASSWORD=your-notification-db-password
AUDIT_DB_PASSWORD=your-audit-db-password
FILE_DB_PASSWORD=your-file-db-password
PLATFORM_DB_PASSWORD=your-platform-db-password

# --- Redis ---
REDIS_HOST=redis
REDIS_PORT=6379
REDIS_PASSWORD=your-redis-password

# --- RabbitMQ ---
RABBITMQ_HOST=rabbitmq
RABBITMQ_PORT=5672
RABBITMQ_USERNAME=restaurantos
RABBITMQ_PASSWORD=your-rabbitmq-password

# --- MinIO ---
MINIO_ENDPOINT=http://minio:9000
MINIO_ACCESS_KEY=minioadmin
MINIO_SECRET_KEY=your-minio-secret
MINIO_BUCKET=restaurantos-dev

# --- OPA ---
OPA_URL=http://opa:8181

# --- ClickHouse ---
CLICKHOUSE_URL=http://clickhouse:8123
CLICKHOUSE_USER=default
CLICKHOUSE_PASSWORD=your-clickhouse-password
CLICKHOUSE_READONLY_USER=nlq_readonly
CLICKHOUSE_READONLY_PASSWORD=your-clickhouse-readonly-password

# --- Service discovery / config ---
EUREKA_URL=http://localhost:8761/eureka
CONFIG_SERVER_URL=http://localhost:8888

# --- JWT (dev keys; generate a real RS256 keypair for staging/prod) ---
JWT_PRIVATE_KEY=dev-only-replace-with-pem
JWT_PUBLIC_KEY_ID=dev-key-1
JWT_JWKS_URL=http://localhost:8081/.well-known/jwks.json
JWT_ACCESS_TTL_SECONDS=900
JWT_REFRESH_TTL_SECONDS=604800

# --- Field-level encryption (AES-256-GCM, base64 32-byte key) ---
FIELD_ENCRYPTION_KEY=dev-base64-32-byte-key-replace-me

# --- Internal service auth ---
INTERNAL_SERVICE_SECRET=your-internal-service-secret

# --- Anthropic (NLQ) ---
ANTHROPIC_API_KEY=sk-ant-your-key
ANTHROPIC_MODEL_SQL=claude-sonnet-4-20250514
ANTHROPIC_MODEL_NARRATIVE=claude-haiku-4-20250514

# --- SMTP (dev uses Mailpit on 1025) ---
SMTP_URL=smtp://mailpit:1025
SMTP_FROM=noreply@restaurantos.local

# --- Observability ---
GLITCHTIP_DSN=

# --- Business config ---
BUSINESS_DAY_OFFSET_HOURS=4
NLQ_MONTHLY_QUOTA_DEFAULT=500
NLQ_USER_HOURLY_LIMIT=30
PO_APPROVAL_TIER1_PAISA=5000000
PO_APPROVAL_TIER2_PAISA=20000000

# --- Gateway rate limits ---
RATE_LIMIT_AUTH_PER_MIN=100
RATE_LIMIT_API_PER_MIN=600

# --- Frontend (browser-exposed; NEXT_PUBLIC_ prefix required) ---
NEXT_PUBLIC_API_BASE_URL=http://localhost:8080
NEXT_PUBLIC_WS_BASE_URL=ws://localhost:8080
NEXT_PUBLIC_GLITCHTIP_DSN=

# --- pgAdmin (dev DB inspection) ---
PGADMIN_DEFAULT_EMAIL=admin@restaurantos.local
PGADMIN_DEFAULT_PASSWORD=your-pgadmin-password
```
