# Phase 11: HR & Payroll - Context

**Gathered:** 2026-07-24
**Status:** Ready for planning
**Note:** Captured autonomously (user delegated the full Phase 11 run, GSD `yolo` mode). Decisions are
grounded in the source-of-truth docs — `Docs/RestaurantERP_SaaS_Specification.md` §M8 and
`.planning/REQUIREMENTS.md` HR-01..HR-08. Items marked **[assumption]** are grounded defaults the user
can override before/at planning; everything else is locked by the spec.

<domain>
## Phase Boundary

Deliver a **new `hr-service` microservice** (port 8088, `hr_db`, gated by `FEATURE_HR`) covering the full
HR/payroll cycle for a Pakistan restaurant tenant:

1. **Employees** with field-encrypted `cnic` + `bank_account_no` (HR-01)
2. **Payroll run** — Pakistan income-tax slabs + EOBI from an annual config-driven `tax_config`; approval/
   payment posts a balanced JE and publishes `PAYROLL_RUN_PAID` for Finance to consume (HR-02, HR-03)
3. **Shift scheduling** (drag-and-drop calendar, per branch, role-based) (HR-04)
4. **Time & attendance + leave** — clock-in/out, leave types/accrual/approval, late-arrival deductions
   feeding payroll; **labour-cost % vs revenue** by shift and branch (HR-05, HR-06)
5. **Biometric attendance devices** — device registry + ADMS/iClock LAN push (Mode A) and USB bridge-agent
   ingest (Mode B), device-authenticated, idempotent/offline-safe, edge-matching only, no central raw
   biometrics (HR-07, HR-08)

**Out of scope (explicitly):** payroll direct-bank-transfer/IBFT automation (spec lists it as future),
reporting/dashboards (Phase 12), NLQ. This phase produces the events + data those consume, not the reports.

</domain>

<decisions>
## Implementation Decisions

### Service shape & integration (locked by spec §7.2 / §M8)
- New `hr-service` on **port 8088**, database **`hr_db`**, own least-privilege NOBYPASSRLS role, FORCE-RLS
  on every tenant table, follows the shared-lib conventions (TenantAuditableEntity, outbox, idempotency,
  processed_events) — mirror the Phase 9/10 service scaffolds exactly.
- Register in `gateway` (route `/api/v1/hr/**`, `FEATURE_HR`), `eureka`, `config-server`,
  `start-dev.ps1`/`restart-service.ps1`, `deploy/init` (`hr_db` + `hr_user`), and each service's shared-infra
  changelog pattern (event_outbox + idempotency_keys + processed_events) — **do not repeat the Phase-9
  crm-service omission** ([[restaurantos-phase-9-state]]).
- Permissions (seed in auth-service, exact set from spec §RBAC): `hr.employee.view/manage`,
  `hr.attendance.view/manage`, `hr.leave.view/approve`, `hr.payroll.run/approve/view`. OPA `hr.rego`,
  100% coverage, tenant+branch isolation, fail-closed.

### Employee master & PII (HR-01)
- `cnic` and `bank_account_no` stored **AES-256-GCM field-encrypted** via the shared-lib crypto seam —
  reuse the exact pattern Phase 10 used for vendor `bank_account` (fail-fast on missing key, never
  silently null).
- Employee is its own entity, **optionally** linked to a platform `user_id` (a cook may have no login).
  **[assumption]** Employee carries: branch, role/designation, employment type (PERMANENT/CONTRACT),
  join/leave dates, and a salary structure (basic + named allowances). Publishes `EMPLOYEE_JOINED` /
  `EMPLOYEE_LEFT`.

### Payroll computation (HR-02)
- `tax_config` is an **annual, config-driven, seeded** table (income-tax slabs + EOBI params) — computation
  reads config, never hardcodes rates in code (spec: "updated annually via config, not code").
- Monthly payroll run: gross = basic + allowances + overtime; deductions = income tax (slab) + EOBI +
  advances + late-arrival deductions; net = gross − deductions. `payroll_lines.deductions_json` holds the
  breakdown (spec schema).
- **[assumption]** Seed the current Pakistan salaried income-tax slabs (FY 2025–26) and standard EOBI
  (employee 1% / employer contribution on the statutory minimum-wage base) as the initial `tax_config`
  row; treat exact figures as config the user/accountant can correct. Late-arrival deduction rule is
  policy-config-driven **[assumption]** (per-minute or per-occurrence — default per-policy table).

### Payroll run lifecycle, JE & events (HR-03) — locked by spec §M8.3
- Lifecycle: `DRAFT → CALCULATED → APPROVED → PAID` (+ `CANCELLED`). Approval is **TOTP-gated** (mirror
  finance period-close) and requires `hr.payroll.approve`; run requires `hr.payroll.run`.
- **Idempotency-Key mandatory** on payroll run (spec §API). Balanced double-entry only.
- GL postings (spec §11 account map — exact accounts):
  - On **approve**: `DR Salary Expense (6200) / CR Wages Payable (2300)`
  - On **disburse/pay**: `DR Wages Payable (2300) / CR Bank (1100)`
- HR posts to Finance the same way Phase 9 does: publish `PAYROLL_RUN_APPROVED` and `PAYROLL_RUN_PAID`;
  **finance-service auto-posts** the JE on consumption (HR does not write finance's ledger directly). This
  reuses the Phase-9 auto-posting-recipe engine — add payroll recipes there.

### Shifts, attendance, leave, labour cost (HR-04/05/06)
- Shift scheduling: role-based, per-branch, backed by a `shifts` + `shift_assignments` model; the
  drag-and-drop calendar is the frontend surface (four-layer API abstraction). **[assumption]** shift
  templates + weekly grid.
- Attendance: `attendance_punches` is the single source (manual clock-in/out AND device punches land in the
  same table); late-arrival / early-leave derived against the assigned shift → payroll deduction feed.
- Leave: leave types + accrual + an approval workflow (`hr.leave.approve`). **[assumption]** default types
  (annual/sick/unpaid) with monthly accrual; balances queryable.
- Labour-cost %: labour cost ÷ revenue, by shift and by branch — HR computes labour cost; revenue comes
  from POS/finance (read via internal seam or event-fed aggregate). **[assumption]** expose as an internal
  metric endpoint; the full report is Phase 12.

### Biometric device integration (HR-07/08) — locked by spec §M8.4
- **Mode A (default, network ADMS/iClock):** HR exposes the plain-text tab-delimited ADMS adapter —
  `GET/POST /iclock/cdata`, `GET /iclock/getrequest`, `POST /iclock/devicecmd` — serial-addressed.
- **Mode B (USB):** local bridge agent posts to `/internal/attendance/ingest` over the device-authenticated
  path (agent connects `wss://127.0.0.1`, forwards server-side).
- **Device registry** `attendance_devices` maps `serial → device_token → branch_id → tenant_id`;
  **tenant/branch resolved from the registry, never client input.** Gateway treats `/iclock/*` and
  `/internal/attendance/ingest` as a **JWT-exempt, device-authenticated, per-device rate-limited** path
  class (device token / HMAC verified, unknown serials rejected) — extends GW-02.
- Punch ingest is **idempotent on `(device_id, device_user_ref, device_reported_at)`**, offline-buffer/replay
  safe, stores **both device + server timestamps**, quarantines unmapped users, persists to
  `attendance_punches`, publishes `ATTENDANCE_PUNCHED`, feeds attendance/payroll.
- **Privacy (HR-08):** matching at the edge (on-device / in-agent); platform stores ONLY
  `employee_id + device_id + punched_at` and **no raw biometrics** by default. Central templates are opt-in,
  and when stored are AES-256-GCM encrypted in a dedicated restricted RLS table with retention.

### Claude's Discretion
- Exact module/package layout, DTO shapes, repository/service seams, IT harness (mirror Phase 9/10).
- Overtime calculation method, payslip PDF layout (file-service), calendar UI component choice.
- Whether shifts/leave land in the same wave as payroll or a later wave (planner decides via waves).
- Test-data personas/seed users for HR (mirror the demo-user seeding pattern).

</decisions>

<specifics>
## Specific Ideas

- Follow the **Phase 9 / Phase 10 service blueprints** verbatim for scaffolding, RLS, outbox, idempotency,
  and the finance auto-post seam — this phase should look like a sibling service, not a new pattern.
- Payroll JE must flow **HR event → finance-service auto-post recipe**, exactly like `ORDER_CLOSED`, so the
  ledger stays owned by finance and balanced-by-construction.
- Device ingest is the one genuinely novel surface (JWT-exempt device-auth path) — treat it as the highest-
  risk area for research and for security review.

</specifics>

<deferred>
## Deferred Ideas

- **Payroll IBFT / direct-bank-transfer automation** — spec lists it as future; out of scope for Phase 11.
- **Provincial PESSI variants** beyond federal EOBI — capture config shape, defer province-specific rules.
- **HR reports / dashboards** (Attendance Summary, Leave Balance, Payroll Summary, Overtime, Staff-cost %) —
  Phase 12 consumes HR events; Phase 11 only emits them + exposes raw/internal metrics.
- **Central biometric template storage** — opt-in only; ship the encrypted-table shape but keep default OFF.

</deferred>

---

*Phase: 11-hr-payroll*
*Context gathered: 2026-07-24*
