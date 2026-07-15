#!/bin/bash
# RestaurantOS dev infrastructure, hosted directly in WSL (no Docker).
#
# Postgres 16, RabbitMQ 3.12 and Redis run as plain processes inside the WSL distro and are
# reachable from Windows at 127.0.0.1 on their standard ports. This distro has no systemd
# (legacy inbox WSL), so nothing auto-starts — run this after a reboot / `wsl --shutdown`.
#
# Usage (from Windows):  pwsh scripts/start-infra.ps1
#        (inside WSL)  :  sudo bash scripts/wsl-infra.sh [start|stop|status]

ACTION="${1:-start}"
PGVER=16

# Every listener must bind IPv4 (0.0.0.0). WSL's localhost relay does NOT forward sockets
# bound to the IPv6 wildcard, so an IPv6-only bind is unreachable from Windows.

start_all() {
    pg_ctlcluster $PGVER main start 2>/dev/null || true

    if ! rabbitmqctl status >/dev/null 2>&1; then
        nohup rabbitmq-server > /var/log/rabbitmq-start.log 2>&1 &
    fi

    if ! redis-cli ping >/dev/null 2>&1; then
        nohup redis-server /etc/redis/redis.conf > /var/log/redis-start.log 2>&1 &
    fi

    for i in $(seq 1 45); do
        pg_isready -q 2>/dev/null \
            && rabbitmqctl await_startup >/dev/null 2>&1 \
            && redis-cli ping >/dev/null 2>&1 \
            && break
        sleep 2
    done
    status_all
}

stop_all() {
    rabbitmqctl stop >/dev/null 2>&1 || true
    redis-cli shutdown nosave >/dev/null 2>&1 || true
    pg_ctlcluster $PGVER main stop 2>/dev/null || true
    echo "stopped"
}

status_all() {
    printf 'postgres : %s\n' "$(pg_isready -q 2>/dev/null && echo UP || echo DOWN)"
    printf 'rabbitmq : %s\n' "$(rabbitmqctl await_startup >/dev/null 2>&1 && echo UP || echo DOWN)"
    printf 'redis    : %s\n' "$(redis-cli ping 2>/dev/null || echo DOWN)"
}

case "$ACTION" in
    start)  start_all ;;
    stop)   stop_all ;;
    status) status_all ;;
    *)      echo "usage: $0 [start|stop|status]"; exit 1 ;;
esac
