# RestaurantOS deploy/Makefile
# All targets run from the deploy/ directory (where docker-compose.yml lives).
# Compose auto-loads .env from this directory.
#
# Usage: make dev-up   (from deploy/ dir, or via root Makefile delegation)

COMPOSE := docker compose

.PHONY: dev-up dev-up-fast dev-down dev-logs dev-ps dev-fix-infra _check-env _pgpass _dev-up-post

# Guard: fail early with a clear message if .env is missing.
# .env is produced by deploy/generate-keys.sh (01-03 deliverable).
_check-env:
	@if [ ! -f .env ] || ! grep -q '^POSTGRES_SUPERUSER=.' .env; then \
		echo ""; \
		echo "ERROR: deploy/.env is missing or incomplete (infra vars required)."; \
		echo "Run: bash deploy/generate-keys.sh"; \
		echo ""; \
		exit 1; \
	fi

# pgAdmin reads Postgres credentials from deploy/.pgpass (generated from .env).
_pgpass:
	@PG_USER=$$(grep '^POSTGRES_SUPERUSER=' .env | cut -d= -f2-); \
	PG_PASS=$$(grep '^POSTGRES_SUPERUSER_PASSWORD=' .env | cut -d= -f2-); \
	printf 'postgres:5432:*:%s:%s\n' "$$PG_USER" "$$PG_PASS" > .pgpass; \
	chmod 600 .pgpass

dev-up: _check-env _pgpass
	$(COMPOSE) up -d --build
	@$(MAKE) _dev-up-post

dev-up-fast: _check-env _pgpass
	$(COMPOSE) up -d
	@$(MAKE) _dev-up-post

_dev-up-post:
	@echo "Waiting for MinIO to be healthy..."
	@$(COMPOSE) exec -T minio sh -c \
		'until mc ready local 2>/dev/null || wget -q --spider http://localhost:9000/minio/health/live 2>/dev/null; do sleep 2; done' || true
	@echo "Creating MinIO bucket..."
	@BUCKET=$$(grep '^MINIO_BUCKET=' .env | cut -d= -f2-); \
	$(COMPOSE) exec -T minio sh -c \
		"mc alias set local http://localhost:9000 \"\$$MINIO_ROOT_USER\" \"\$$MINIO_ROOT_PASSWORD\" && \
		 mc mb --ignore-existing local/$$BUCKET" || true
	@$(MAKE) dev-fix-infra
	@echo ""
	@echo "=== Stack started. Run 'make dev-ps' to check health status. ==="

dev-fix-infra: _check-env
	@bash scripts/ensure-dev-infra.sh

dev-down:
	$(COMPOSE) down

dev-logs:
	$(COMPOSE) logs -f

dev-ps:
	$(COMPOSE) ps
