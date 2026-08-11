# RestaurantOS root Makefile — delegates to deploy/Makefile.
# SC1 wording: `make dev-up` from the repository root.

# Pin JDK 25 for all Make targets (Homebrew keg-only openjdk@25).
JAVA_HOME ?= /opt/homebrew/opt/openjdk@25/libexec/openjdk.jdk/Contents/Home
export JAVA_HOME
export PATH := $(JAVA_HOME)/bin:$(PATH)

.PHONY: dev-up dev-up-fast dev-rebuild dev-down dev-logs dev-ps dev-fix-infra java-version mvn-compile verify-guide-claims

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

# 37-02: the finance guide's honesty gate. THE entry point — CI and a developer run this exact
# command, so a check that passes locally cannot fail differently in CI. Node stdlib only, no
# install step, ~0.3s. Fails the build if a guide claim has no live assertion, if an assertion
# names a claim nobody declares, or if the guide names a code the product no longer emits.
verify-guide-claims:
	node scripts/verify-finance-guide-claims.mjs
