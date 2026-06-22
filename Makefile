# RestaurantOS root Makefile — delegates to deploy/Makefile.
# SC1 wording: `make dev-up` from the repository root.

.PHONY: dev-up dev-down dev-logs dev-ps

dev-up:
	$(MAKE) -C deploy dev-up

dev-down:
	$(MAKE) -C deploy dev-down

dev-logs:
	$(MAKE) -C deploy dev-logs

dev-ps:
	$(MAKE) -C deploy dev-ps
