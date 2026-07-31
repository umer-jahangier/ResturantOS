# RestaurantOS deploy/Makefile
# All targets run from the deploy/ directory (where docker-compose.yml lives).
# Compose auto-loads .env from this directory.
#
# Usage: make dev-up   (from deploy/ dir, or via root Makefile delegation)

COMPOSE := docker compose

.PHONY: dev-up dev-up-fast dev-rebuild dev-down dev-logs dev-ps dev-fix-infra _check-env _pgpass _dev-up-post

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

# dev-up is the WORKING default: no --build. The in-Docker Maven build for
# eureka/config-server force-rebuilds on every `make dev-up` and OOMs/fails on an
# 8GB host; the images are already built. Use `make dev-rebuild` when the JARs
# genuinely need rebuilding.
dev-up: _check-env _pgpass
	@bash ../scripts/dev-stack-up.sh
	@$(MAKE) _dev-up-post

# Alias kept for existing muscle memory (docs/scripts referenced dev-up-fast before
# dev-up itself was fixed to be the fast, working path).
dev-up-fast: dev-up

# Rebuild JARs on the HOST (fast, reuses ~/.m2 cache, no in-Docker Maven/OOM risk),
# then build the eureka/config-server images from the prebuilt jars and restart them.
dev-rebuild: _check-env
	@echo "Building JARs on host (shared-lib, eureka-server, config-server)..."
	@cd .. && mvn -q -pl shared-lib,eureka-server,config-server -am -DskipTests package
	@echo "Building eureka-server image from prebuilt jar..."
	@docker build -f ../eureka-server/Dockerfile.host -t restaurantos/eureka-server:1.0.0 ../eureka-server
	@echo "Building config-server image from prebuilt jar..."
	@docker build -f ../config-server/Dockerfile.host -t restaurantos/config-server:1.0.0 ../config-server
	$(COMPOSE) up -d --no-deps eureka config-server
	@echo "=== Rebuilt and restarted eureka + config-server from host-built jars. ==="

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
	@echo "=== Stack started and health-gated. Run 'make dev-ps' to check status. ==="

# NOTE: scripts/dev-stack-up.sh's health gate is now the source of truth for
# "is the stack up". dev-fix-infra remains for idempotent repairs to EXISTING
# volumes (Postgres role/grant drift) — it no longer needs to touch RabbitMQ users,
# since those are now declarative (deploy/init/rabbitmq-definitions.template.json).
dev-fix-infra: _check-env
	@bash scripts/ensure-dev-infra.sh

dev-down:
	$(COMPOSE) down

dev-logs:
	$(COMPOSE) logs -f

dev-ps:
	$(COMPOSE) ps
