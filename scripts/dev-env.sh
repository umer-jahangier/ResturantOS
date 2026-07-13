#!/usr/bin/env bash
# RestaurantOS — macOS dev environment (JDK 25, Maven, pnpm on PATH)
# Usage: source scripts/dev-env.sh

# Homebrew keg-only openjdk@25 (override with JAVA_HOME if you use a different JDK 25 install)
export JAVA_HOME="${JAVA_HOME:-/opt/homebrew/opt/openjdk@25/libexec/openjdk.jdk/Contents/Home}"
export PATH="$JAVA_HOME/bin:$PATH"

if command -v brew >/dev/null 2>&1; then
  for p in /opt/homebrew/bin /usr/local/bin; do
    case ":$PATH:" in
      *":$p:"*) ;;
      *) PATH="$p:$PATH" ;;
    esac
  done
fi

# Docker Desktop CLI is often missing from PATH (broken /usr/local/bin symlink, etc.)
if ! command -v docker >/dev/null 2>&1; then
  for docker_bin in \
    "/Applications/Docker.app/Contents/Resources/bin" \
    "${HOME}/.docker/bin"; do
    if [[ -x "$docker_bin/docker" ]]; then
      PATH="$docker_bin:$PATH"
      break
    fi
  done
fi
export PATH

if [[ -n "${PNPM_HOME:-}" ]]; then
  export PATH="$PNPM_HOME:$PATH"
fi
