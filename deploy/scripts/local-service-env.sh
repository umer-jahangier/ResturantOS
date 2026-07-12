#!/usr/bin/env bash
# Delegates to the canonical host-run env script at repo scripts/local-service-env.sh
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=/dev/null
source "$SCRIPT_DIR/../../scripts/local-service-env.sh"
