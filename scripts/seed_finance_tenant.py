#!/usr/bin/env python3
"""
Seed finance COA (~55 accounts) and 12 Jul–Jun accounting periods for a tenant.

Calls the finance-service internal provisioning API (same path used by platform saga).
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.request
import uuid
from datetime import date
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_SLUG = "dev"
UUID_NS = uuid.UUID("6ba7b810-9dad-11d1-80b4-00c04fd430c8")
DEFAULT_TENANT_ID = str(uuid.uuid5(UUID_NS, f"restaurantos/tenant/{DEFAULT_SLUG}"))
DEFAULT_FINANCE_URL = "http://127.0.0.1:8086"
DEFAULT_INTERNAL_SECRET = "dev-internal-secret"


def load_deploy_env() -> dict[str, str]:
    env: dict[str, str] = {}
    dotenv = REPO_ROOT / "deploy" / ".env"
    if not dotenv.is_file():
        return env
    for raw in dotenv.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        env[key.strip()] = value.strip()
    return env


def pakistan_fiscal_year(today: date | None = None) -> int:
    today = today or date.today()
    return today.year + 1 if today.month >= 7 else today.year


def provision(tenant_id: str, finance_url: str, internal_secret: str, fiscal_year: int) -> dict:
    url = f"{finance_url.rstrip('/')}/internal/tenants/{tenant_id}/provision"
    body = json.dumps({"fiscalYear": fiscal_year}).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=body,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "X-Internal-Service": internal_secret,
        },
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        payload = json.load(response)
    return payload.get("data", payload)


def main() -> int:
    deploy_env = load_deploy_env()
    default_internal_secret = (
        os.getenv("INTERNAL_SERVICE_SECRET")
        or deploy_env.get("INTERNAL_SERVICE_SECRET")
        or DEFAULT_INTERNAL_SECRET
    )
    parser = argparse.ArgumentParser(description="Seed finance COA and periods for a tenant")
    parser.add_argument("--tenant-id", default=os.getenv("TENANT_ID", DEFAULT_TENANT_ID))
    parser.add_argument("--finance-url", default=os.getenv("FINANCE_SERVICE_URL", DEFAULT_FINANCE_URL))
    parser.add_argument(
        "--internal-secret",
        default=default_internal_secret,
    )
    parser.add_argument(
        "--fiscal-year",
        type=int,
        default=int(os.getenv("FISCAL_YEAR", pakistan_fiscal_year())),
    )
    args = parser.parse_args()

    try:
        result = provision(args.tenant_id, args.finance_url, args.internal_secret, args.fiscal_year)
    except urllib.error.HTTPError as exc:
        print(f"Provisioning failed: HTTP {exc.code}", file=sys.stderr)
        print(exc.read().decode("utf-8", errors="replace"), file=sys.stderr)
        return 1
    except urllib.error.URLError as exc:
        print(f"Could not reach finance-service at {args.finance_url}: {exc}", file=sys.stderr)
        return 1

    accounts = result.get("accountsSeeded", result.get("accounts_seeded", 0))
    periods = result.get("periodsSeeded", result.get("periods_seeded", 0))
    print(f"Tenant {args.tenant_id} provisioned for FY {args.fiscal_year}")
    print(f"  accounts seeded: {accounts}")
    print(f"  periods seeded:  {periods}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
