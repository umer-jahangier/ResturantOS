# RestaurantOS deploy/Makefile
# All targets run from the deploy/ directory (where docker-compose.yml lives).
# Compose auto-loads .env from this directory.
#
# Usage: make dev-up   (from deploy/ dir, or via root Makefile delegation)

COMPOSE := docker compose

.PHONY: dev-up dev-down dev-logs dev-ps _check-env

# Guard: fail early with a clear message if .env is missing.
# .env is produced by deploy/generate-keys.sh (01-03 deliverable).
_check-env:
	@if [ ! -f .env ]; then \
		echo ""; \
		echo "ERROR: deploy/.env is missing."; \
		echo "Run 'deploy/generate-keys.sh' (01-03) to create it, or copy .env.example."; \
		echo ""; \
		exit 1; \
	fi

dev-up: _check-env
	$(COMPOSE) up -d --build
	@echo "Waiting for MinIO to be healthy..."
	@$(COMPOSE) exec -T minio sh -c \
		'until mc ready local 2>/dev/null || wget -q --spider http://localhost:9000/minio/health/live 2>/dev/null; do sleep 2; done' || true
	@echo "Creating MinIO bucket..."
	$(COMPOSE) exec -T minio sh -c \
		'mc alias set local http://localhost:9000 "$$MINIO_ROOT_USER" "$$MINIO_ROOT_PASSWORD" && \
		 mc mb --ignore-existing local/$$MINIO_BUCKET' || true
	@echo ""
	@echo "=== Stack started. Run 'make dev-ps' to check health status. ==="

dev-down:
	$(COMPOSE) down

dev-logs:
	$(COMPOSE) logs -f

dev-ps:
	$(COMPOSE) ps
