# RestaurantOS root Makefile — delegates to deploy/Makefile.
# SC1 wording: `make dev-up` from the repository root.

# Pin JDK 25 for all Make targets (Homebrew keg-only openjdk@25).
JAVA_HOME ?= /opt/homebrew/opt/openjdk@25/libexec/openjdk.jdk/Contents/Home
export JAVA_HOME
export PATH := $(JAVA_HOME)/bin:$(PATH)

.PHONY: dev-up dev-up-fast dev-rebuild dev-down dev-logs dev-ps dev-fix-infra java-version mvn-compile

dev-up:
	$(MAKE) -C deploy dev-up

dev-up-fast:
	$(MAKE) -C deploy dev-up-fast

dev-rebuild:
	$(MAKE) -C deploy dev-rebuild

dev-down:
	$(MAKE) -C deploy dev-down

dev-logs:
	$(MAKE) -C deploy dev-logs

dev-ps:
	$(MAKE) -C deploy dev-ps

dev-fix-infra:
	$(MAKE) -C deploy dev-fix-infra

java-version:
	@java -version

mvn-compile:
	mvn -pl shared-lib,eureka-server,config-server -am -DskipTests compile
