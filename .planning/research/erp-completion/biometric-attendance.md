# Biometric Attendance Device Integration — What ResturantOS Has, What the Protocol Really Is, and How to Test It Without Hardware

**Date:** 2026-08-07
**Scope:** HR check-in/check-out via biometric terminals (ZKTeco ADMS/iClock push, vendor alternatives, pull mode), plus a hardware-free test procedure for the ingest path that already exists in this repo.
**Method:** every repo claim below was read in the file cited. Every external claim is attributed to a page or file that was actually fetched this session. The runtime behaviour in §3 was produced by running a throwaway `@SpringBootTest(webEnvironment = RANDOM_PORT)` probe against hr-service on a Testcontainers Postgres and reading the raw HTTP responses; the probe file was deleted afterwards, and the exact procedure to recreate it is in §7.

---

## 1. Executive summary

ResturantOS **already implements the ZKTeco ADMS/iClock server side end-to-end**: four `/iclock/*` endpoints, a defensive tab-separated ATTLOG parser, a device registry with an encrypted per-device token, tenant/branch derivation from the registry (no client-supplied tenant), idempotent inserts, a quarantine workflow for unmapped device user IDs, an event on genuine insert, a JSON "Mode B" ingest for a USB bridge agent, gateway routing with per-device rate limiting, and 8 passing integration tests. This is not a greenfield build.

What it does **not** have is a path a stock ZKTeco device can actually walk. Four verified defects sit between the current code and a working device:

1. **The device token is passed as a `?token=` query parameter, and a stock ZKTeco terminal cannot send one.** Its ADMS configuration menu accepts only a server address and a port — the `/iclock/cdata` path and its query string are firmware-generated. A real device would be rejected on its very first request. **This is the single blocking issue.**
2. **A device-auth failure returns HTTP 500 `INTERNAL_ERROR`, not 401** — verified at runtime. The shared `@ExceptionHandler(Exception.class)` swallows `DeviceAuthException` before its `@ResponseStatus(UNAUTHORIZED)` applies.
3. **An ATTLOG POST sent with `Content-Type: application/x-www-form-urlencoded` is silently dropped** — verified at runtime: HTTP 200 `OK`, zero rows written, no log line. The servlet container consumes the body into request parameters and `@RequestBody` reads an empty stream.
4. **`GET /iclock/getrequest` returns an empty body when no commands are queued**; the reference implementation probed against real hardware returns `OK`. Unverified whether firmware tolerates an empty body.

Plus three lower-severity gaps: the `FEATURE_HR` gate on `/iclock/**` is inert at the gateway, the URL handed to the installer at device registration is still the literal placeholder `https://REPLACE-WITH-GATEWAY-HOST/iclock`, and only `yyyy-MM-dd HH:mm:ss` timestamps parse (Unix-epoch ATTLOG lines are silently dropped).

**None of this requires hardware to fix or to verify.** §7 gives the exact procedure.

---

## 2. What exists in the repo (read, not assumed)

### 2.1 The ADMS adapter — `services/hr-service/src/main/java/io/restaurantos/hr/adms/`

`AdmsController.java` implements four handlers, all `text/plain`:

| Handler | Mapping | Behaviour |
|---|---|---|
| `cdataHandshake` | `GET /iclock/cdata` | Resolves device, returns the `GET OPTION FROM:` config block |
| `cdataUpload` | `POST /iclock/cdata` | If `table=ATTLOG`, splits body on `\r?\n`, parses and ingests each line, returns `OK` |
| `getRequest` | `GET /iclock/getrequest` | Returns `commandQueue.pendingCommandsFor(sn)` |
| `deviceCmd` | `POST /iclock/devicecmd` | Records the ack, returns `OK` |

Every handler takes `@RequestParam("SN")` (required) and `@RequestParam(value = "token", required = false)`, calls `deviceAuthResolver.resolve(sn, token)` **first**, and clears `TenantContext` in a `finally` — the pooled-thread leak is genuinely handled, and the comment at `AdmsController.java:65-67` explains why `resolve()` sits inside the `try`.

The handshake body it emits (`AdmsController.java:44-53`):

```
GET OPTION FROM: <SN>
Stamp=0
OpStamp=0
ErrorDelay=30
Delay=30
TransTimes=00:00;14:05
TransInterval=1
TransFlag=1111000000
Realtime=1
Encrypt=0
```

`AttlogLineParser.java` splits on `\t`, requires **at least 4 fields**, reads `f[0]`=PIN, `f[1]`=timestamp (`yyyy-MM-dd HH:mm:ss`, interpreted as `Asia/Karachi`), `f[2]`=status (`0`→IN, `1`→OUT, anything else→UNKNOWN), and treats `f[4]` as a `sourceRecordId`. Unparseable or short lines return `Optional.empty()` rather than throwing — the defensive behaviour is real and tested.

`DeviceCommandQueueService.java` is a deliberate stub: `pendingCommandsFor` returns `""` and `recordAck` is a no-op.

### 2.2 The auth boundary — `adms/DeviceAuthResolver.java`

Resolves the device by serial through `AttendanceDeviceRepository.resolveBySerial`, which calls the `resolve_device(TEXT)` SECURITY DEFINER SQL function added in `services/hr-service/src/main/resources/db/changelog/v1.0.0/031-device-resolve-fn.xml`. That function exists precisely because `attendance_devices` has `FORCE ROW LEVEL SECURITY` and the device path has no tenant GUC yet. It then checks `isActive()`, checks the token with `MessageDigest.isEqual` (constant-time), and **only then** binds `TenantContext` and sets the tenant GUC transaction-locally so the `last_seen_at` write is permitted.

The changelog carries an explicit deploy warning (`031-device-resolve-fn.xml:15-18`): SECURITY DEFINER bypasses FORCE RLS only if the function owner is a superuser or `BYPASSRLS` role, which holds in Testcontainers but must be verified in production. `deploy/init/05-hr-fn-owner.sql` and `deploy/scripts/verify-security-definer-owners.sh` exist to address this.

### 2.3 The ingest funnel — `service/PunchIngestService.java`

One method serves both modes. It resolves the employee through the **durable** `employees.device_user_ref` mapping (`uk_employees_tenant_device_ref UNIQUE (tenant_id, device_user_ref)`), and:

- unmapped ref → row in `attendance_quarantine` with `status='PENDING'` and the raw line preserved, returns `QUARANTINED`;
- mapped ref → native `INSERT … ON CONFLICT (device_id, device_user_ref, device_reported_at) DO NOTHING`;
- `rows == 0` → returns `DUPLICATE` and **publishes nothing**;
- `rows == 1` → publishes `ATTENDANCE_PUNCHED` to exchange `hr.topic`, routing key `hr.attendance.punched`.

`resolveQuarantine(quarantineId, employeeId)` writes the durable mapping onto the employee, re-ingests the parked punch, and marks the quarantine `RESOLVED`; it refuses if the ref is already mapped to a different employee.

### 2.4 Schema — `db/changelog/v1.0.0/010-create-hr-tables.xml`, `011-enable-rls-hr-tables.xml`

`attendance_devices` (serial globally unique, `device_token BYTEA NOT NULL`, `last_seen_at`, `is_active`), `attendance_punches` (both `device_reported_at` and `server_received_at`, `source_record_id`, `CONSTRAINT uk_attendance_punch UNIQUE (device_id, device_user_ref, device_reported_at)`), `attendance_quarantine`, and `biometric_templates` (encrypted, with `retention_expires_at`). All four get `ENABLE` + `FORCE ROW LEVEL SECURITY` with a `tenant_isolation` policy.

The device token is stored AES-256-GCM encrypted via `@Convert(converter = EncryptedStringConverter.class)` on `entity/AttendanceDeviceEntity.java`, and returned in plaintext exactly once in `DeviceRegistrationResponse` (`dto/DeviceDtos.java`).

### 2.5 Mode B (USB bridge) — `controller/internal/AttendanceIngestController.java`

`POST /internal/attendance/ingest` takes `{serial, token, employeeRef, punchType, punchedAt}` and returns `{"result": "INSERTED|DUPLICATE|QUARANTINED"}`. It is authenticated by the same device token, **not** by `X-Internal-Service` — `config/HrInternalServiceFilter.java:29-41` explicitly excludes this path, with a comment recording that requiring the internal header made the endpoint return 403 one hundred percent of the time through the gateway. The wire contract is documented at `Docs/agent-specs/usb-bridge-agent-ingest-contract.md`. **The bridge agent binary itself does not exist in this repo** — a filesystem search for `*bridge*` outside `.claude/` returns only that markdown file.

### 2.6 Admin surface

- `controller/AttendanceDeviceController.java` — `POST/GET /api/v1/hr/devices`, `DELETE /api/v1/hr/devices/{id}`.
- `controller/QuarantineController.java` — `GET /api/v1/hr/attendance/quarantine`, `POST /api/v1/hr/attendance/quarantine/{id}/resolve?employeeId=`.
- Frontend: `frontend/lib/repositories/hr.repository.ts:217-222` calls the quarantine list and resolve endpoints, and `frontend/app/(tenant)/app/hr/attendance/page.tsx` renders quarantine. **No frontend calls `/api/v1/hr/devices`** — a grep for `hr/devices` across `frontend/lib` and `frontend/app` returns nothing. Device registration is API-only today.

### 2.7 Gateway

- `gateway/src/main/java/io/restaurantos/gateway/filter/JwtGlobalFilter.java:68-69` — `/iclock` and `/internal/attendance/ingest` are in `PUBLIC_PATHS` (JWT skip only).
- `gateway/src/main/resources/application.yml:348-377` — routes `hr-iclock-route` (`Path=/iclock/**`) and `hr-attendance-ingest-route`, both with `RequestRateLimiter` keyed by `#{@deviceKeyResolver}` and a `hrCircuitBreaker`.
- `gateway/src/main/java/io/restaurantos/gateway/config/RateLimitConfig.java:63-69` — `deviceKeyResolver` keys on the `SN` **query parameter**, falling back to `"unknown"`.
- `gateway/src/main/java/io/restaurantos/gateway/support/RouteFeatureMap.java:40-41` — `/iclock/` and `/internal/attendance/` map to `FEATURE_HR`.

### 2.8 Tests that exist and pass

`services/hr-service/src/test/java/io/restaurantos/hr/AdmsIngestIT.java` (4 tests) and `DeviceAuthResolverIT.java` (4 tests). **Verified by running them this session:**

```
mvn -o -pl services/hr-service verify -Dit.test='AdmsIngestIT,DeviceAuthResolverIT' \
    -Dsurefire.failIfNoSpecifiedTests=false -Dtest='none' -Djacoco.skip=true
→ Tests run: 4 … in io.restaurantos.hr.AdmsIngestIT
→ Tests run: 4 … in io.restaurantos.hr.DeviceAuthResolverIT
→ Tests run: 8, Failures: 0, Errors: 0, Skipped: 0   BUILD SUCCESS
```

They cover: defensive parse + idempotent replay + exactly-one event; quarantine → resolve → durable auto-resolve; wrong token rejected with no rows; Mode B JSON ingest.

**The gap in that coverage is the whole reason the defects in §3 survived:** `AdmsIngestIT` calls `admsController.cdataUpload(...)` as a **Java method**, not over HTTP. Query-parameter binding, `Content-Type` handling, the servlet body stream, and the HTTP status a device actually receives are all outside its reach.

---

## 3. Verified runtime findings (raw HTTP against the running service)

Probe: `@SpringBootTest(webEnvironment = RANDOM_PORT)` extending `HrTestBase`, `java.net.http.HttpClient` pinned to HTTP/1.1, real Postgres container. Output verbatim:

| # | Request | Status | Body | Rows written |
|---|---|---|---|---|
| 1 | `GET /iclock/cdata?SN=…&options=all&pushver=2.4.0&language=69` (**no token** — what a stock device sends) | **500** | `{"error":{"code":"INTERNAL_ERROR",…}}` | — |
| 2 | `GET /iclock/cdata?SN=…&token=…&options=all` | 200 | full `GET OPTION FROM:` block | — |
| 3 | `POST …&table=ATTLOG&Stamp=9999`, `Content-Type: text/plain`, body `7001\t2026-06-15 09:30:00\t0\t1\t0\t0\t0` | 200 | `OK` | 0 → **1** |
| 4 | Same, `Content-Type: application/x-www-form-urlencoded` | 200 | `OK` | 1 → **1 (dropped)** |
| 5 | Same, **no** `Content-Type` header | 200 | `OK` | 1 → **2** |
| 6 | `GET /iclock/getrequest?SN=…&token=…` | 200 | `` (**empty**) | — |
| 7 | `GET /iclock/cdata?SN=…&token=nope&options=all` | **500** | `INTERNAL_ERROR` | — |
| 8 | `POST …&table=ATTLOG`, body `7001\t1781000000\t0\t1` (Unix epoch) | 200 | `OK` | 2 → **2 (dropped)** |
| 9 | `POST /iclock/devicecmd?SN=…&token=…`, body `ID=1&Return=0&CMD=INFO` | 200 | `OK` | — |
| 10 | `POST /internal/attendance/ingest` (JSON, Mode B) | 200 | `{"result":"INSERTED"}` | 2 → **3** |

Also captured: `DeviceRegistrationResponse.serverUrl` = `https://REPLACE-WITH-GATEWAY-HOST/iclock`.

Server log accompanying rows 1 and 7:

```
ERROR i.r.shared.api.GlobalExceptionHandler : [unknown] Unhandled exception:
io.restaurantos.hr.adms.DeviceAuthException: Invalid device token
```

### 3.1 Defect A (BLOCKING) — a stock ZKTeco device cannot present the token

`DeviceAuthResolver.resolve` calls `deviceService.verifyToken(device, presentedToken)`, and `AttendanceDeviceService.verifyToken` returns `false` when `presentedToken == null` (`AttendanceDeviceService.java:84-91`). So the optional `token` query parameter is in practice **mandatory**.

A ZKTeco device's ADMS menu (`COMM → Cloud Server Setting` / `ADMS`) exposes only *Enable Domain Name*, *Server Address*, *Server Port*, and proxy settings — the [ZKTeco SC800 manual, p.106](https://www.manualslib.com/manual/2971759/Zkteco-Sc800.html?page=106) lists exactly "Enable", "Domain Name", "Cloud Server Address" ("IP address of the ADMS server"), "Cloud Server Port". Vendors integrating this confirm the same shape: ClockIt's setup instructions say the device needs one setting, ["Server Url: http://adms.clockit.io"](https://help.clockit.io/en/articles/1082333-how-to-add-a-biometric-time-and-attendance-device-to-clockit-using-pull-or-adms-push), and identify the device by **serial number** alone. The `/iclock/cdata` path and its query string are emitted by firmware; there is no field in which an installer can type `?token=…`.

I could not find any documented ADMS query parameter or header that carries a per-device shared secret. The one authentication-adjacent concept in the ZK ecosystem is the *comm key*, which belongs to the pull/standalone SDK, not the HTTP push protocol. **Treat "ADMS has no per-device HTTP authentication" as the working assumption, and design around it.**

Options, in order of how much they preserve the current security posture:

- **Path-embedded token.** Some deployments front the device with a per-branch reverse-proxy vhost/hostname; the gateway can map hostname → device secret and inject it. Preserves the current resolver unchanged. Needs one hostname (or one port) per branch.
- **Serial-only trust plus network controls** (mTLS at the gateway, IP allowlist per branch, or a site-to-site VPN). This is what most commercial ADMS servers do — ClockIt and the OSS implementations authenticate on serial alone.
- **Bridge every device through the Mode B agent**, which *can* carry a token because we write it. This is the only option that needs no protocol concession, but it needs the agent binary, which does not exist yet.

Whatever is chosen, the serial must stay unguessable-or-irrelevant: `attendance_devices.serial_no` is globally unique and `resolve_device` is a by-serial lookup, so serial-only trust means **anyone who learns a serial can post punches for that tenant**. That trade must be made explicitly, not by accident.

### 3.2 Defect B — device-auth failures are 500, not 401

`adms/DeviceAuthException.java` carries `@ResponseStatus(HttpStatus.UNAUTHORIZED)`, but `shared-lib/src/main/java/io/restaurantos/shared/api/GlobalExceptionHandler.java:186` declares `@ExceptionHandler(Exception.class)`, which matches first and returns `INTERNAL_ERROR`. This is exactly the failure mode already documented in `services/hr-service/src/test/java/io/restaurantos/hr/exception/TotpRequiredResponseTest.java` ("the shared advice ends in `@ExceptionHandler(Exception.class)`, and with only that in place this exception was answered with `500 INTERNAL_ERROR`"). The fix is the same: add an `@ExceptionHandler(DeviceAuthException.class)` to `HrExceptionHandler`, and pin it with a `MockMvc` test alongside the TOTP one.

Consequences beyond aesthetics: an unknown/spoofed serial produces a **stack trace at ERROR level on every poll** (a device polls every 3–8 s per the hardware-probed datasheet in §4.5), which is a log-flooding and disk-fill vector; and the gateway's `hrCircuitBreaker` is configured on `statusCodes: [503]` for these routes, so 500s do not trip it.

### 3.3 Defect C — form-urlencoded ATTLOG bodies are silently discarded

Row 4 above: 200 `OK`, zero rows, nothing logged. When a POST arrives with `Content-Type: application/x-www-form-urlencoded`, the servlet container parses the body into request parameters; `@RequestBody(required = false) String body` then binds `null` and `cdataUpload`'s `body != null` guard skips the loop, returning `OK`.

The ZKTeco datasheet in `s0x90/zkteco-adms` shows `Content-Type: text/plain` for the ATTLOG POST and `application/x-www-form-urlencoded` for the `c=registry` POST — so on the documented happy path this does not bite. But it is a silent-data-loss branch that depends on a header the device chooses, and firmware varies. Two independent hardenings: return a distinguishable response (or at minimum log) when `table=ATTLOG` yields zero parsed lines, and read the body from `HttpServletRequest.getInputStream()` (or add a filter that skips form parsing on `/iclock/**`) instead of relying on `@RequestBody`.

### 3.4 Defect D — empty `getrequest` body

`DeviceCommandQueueService.pendingCommandsFor` returns `""`. The reference implementation whose datasheet was produced by probing real hardware states plainly: "If no commands are pending, the server responds with `OK`" ([s0x90/zkteco-adms `datasheet/ADMS.md`](https://github.com/s0x90/zkteco-adms)), and its `writeCommandsOrOK` writes `respOK` when the queue drains empty. The Laravel package does the same (`AdmsResponseBuilder::commands` returns `response('OK')` on an empty collection). **I could not verify what firmware does with a zero-length 200.** Returning `OK` costs nothing and matches two independent implementations.

### 3.5 Lower-severity gaps

- **`FEATURE_HR` is not actually enforced on `/iclock/**`.** `JwtGlobalFilter.filter` returns `chain.filter(exchange)` immediately for a public path (line 136-138) without setting `X-Tenant-Id`; `FeatureFlagGlobalFilter.filter` then hits `if (tenantIdHeader == null) { return chain.filter(exchange); }` (lines 129-132, whose own comment reads "JwtGlobalFilter would have blocked this — safety check only") and passes the request straight through. The `RouteFeatureMap` entry for `/iclock/` is unreachable for real device traffic. The route comments in `application.yml:344` and `JwtGlobalFilter.java:66-70` assert the gate is active; it is not. (Deriving the tenant at the edge is not possible without a serial→tenant lookup at the gateway, so the honest fix is either to move the check into `PunchIngestService` or to drop the claim.)
- **`deviceKeyResolver` degenerates to `"unknown"` on `/internal/attendance/ingest`** — that route has no `SN` query parameter (the serial is in the JSON body), so every bridge agent in every tenant shares one rate-limit bucket.
- **`restaurantos.hr.device-server-url` is configured nowhere.** Grep across all `*.yml`/`*.yaml` finds no override, and the probe confirmed the registration response hands the installer `https://REPLACE-WITH-GATEWAY-HOST/iclock`.
- **Unix-epoch timestamps are dropped** (row 8). The Go reference parser accepts both `2006-01-02 15:04:05` and a Unix epoch integer (`parser.go`, `parseAttendanceRecords`). ResturantOS accepts only the former, and drops the line silently.
- **Device timezone is hardcoded** to `Asia/Karachi` in `AttlogLineParser.java:21`. Correct for the current market, wrong the moment a second country is onboarded; the device zone belongs on `attendance_devices`.
- **`sourceRecordId` reads field index 4, which is `WorkCode`.** Both the Go library (`types.go`: `attFieldWorkCode = 4`) and the Laravel parser (`'work_code' => $fields[4]`) identify that column as WorkCode. It is not a record id. Harmless today — `source_record_id` is not part of the uniqueness constraint — but the field name is a lie that will mislead the next reader.
- **Minimum field count is 4**, versus `attMinFields = 2` in the Go reference. A firmware that emits `PIN\tDateTime\tStatus` (3 fields) would have every punch dropped silently.
- **No device-liveness alerting.** `last_seen_at` is written on every resolve but nothing reads it; a terminal that stops pushing is invisible until someone notices missing attendance.

---

## 4. The ZKTeco ADMS / iClock push protocol

### 4.1 What it is

ADMS ("Automatic Data Master Server", also seen as Attendance Device Management System) is ZKTeco's proprietary HTTP protocol by which terminals push attendance and access logs to a server. It is plain HTTP with query parameters and a plain-text body — no JSON, no XML, no official public specification. ([s0x90/zkteco-adms `datasheet/ADMS.md`](https://github.com/s0x90/zkteco-adms))

### 4.2 Endpoints

| Endpoint | Method | Purpose |
|---|---|---|
| `/iclock/cdata` | GET | Handshake — device fetches operating config |
| `/iclock/cdata` | POST | Data upload — `table=ATTLOG`, `OPERLOG`, `options`, `BIODATA`, `BIOPHOTO` |
| `/iclock/getrequest` | GET | Device polls for queued server commands |
| `/iclock/devicecmd` | POST | Device reports command execution results |
| `/iclock/registry` | GET/POST | Device registration / capability payload (in the Go implementation) |
| `/iclock/test` | GET/POST | Connection test (in some implementations) |

Sources: [s0x90/zkteco-adms](https://github.com/s0x90/zkteco-adms) (Go, includes a datasheet written from probing a SpeedFace-V5L-RFID on firmware ZAM180-NF-Ver1.1.17), [saifulcoder/adms-server-ZKTeco Postman collection](https://github.com/saifulcoder/adms-server-ZKTeco/blob/main/ADMS%20server%20ZKTeco.postman_collection.json), [mmd-rehan/ADMS-server-ZKTeco](https://github.com/mmd-rehan/ADMS-server-ZKTeco), [fedotovaleksandr/iclockhelper](https://github.com/fedotovaleksandr/iclockhelper).

ResturantOS implements the first four and not `/iclock/registry` or `/iclock/test`. Whether a given firmware requires them is **unverified**.

### 4.3 Handshake

Device → server, on boot. Two real captures:

```
GET /iclock/cdata?SN=BOCK200961014&options=all&language=69&pushver=2.4.0&DeviceType=middle%20east&PushOptionsFlag=1
GET /iclock/cdata?SN=3383154200002&pushver=3.0.1&options=all
```

(first from the [saifulcoder Postman collection](https://github.com/saifulcoder/adms-server-ZKTeco/blob/main/ADMS%20server%20ZKTeco.postman_collection.json), tested against an X100-C; second from search results quoting the PUSH SDK protocol document).

Server → device, the configuration block. The Laravel package builds it as (`AdmsResponseBuilder::deviceOptions`):

```
GET OPTION FROM: {serial}
Stamp={att_stamp}
OpStamp={op_stamp}
ErrorDelay=60
Delay=30
TransTimes=…
TransInterval=1
TransFlag=TransData AttLog OpLog AttPhoto
Realtime=1
Encrypt=0
```

Field meanings (from the HTTPPUSH SDK explanation document, reached via search-result excerpts — the PDF itself could not be fetched, cert mismatch on `f02.s.alicdn.com`):

- `GET OPTION FROM:` — the serial number of the corresponding device
- `Stamp` — timestamp mark of the latest attendance record the device uploaded
- `OpStamp` — same, for operation/personnel records
- `ErrorDelay` — seconds to wait before reconnecting after a network failure
- `Delay` — polling interval
- `TransTimes` — fixed times of day to check and send new data (`HH:MM;HH:MM`, 24h)
- `TransInterval` — minutes between transfers
- `TransFlag` — which data types the client uploads automatically
- `Realtime` — 1 = push immediately, do not wait for `TransTimes`
- `Encrypt` — 0 = plaintext

**`TransFlag` has two observed encodings**: a bitmask string (`TransFlag=1111000000`, what ResturantOS emits) and a word list (`TransFlag=TransData AttLog OpLog AttPhoto`, what the Laravel package emits). Both appear in the wild. **I could not verify which encoding a given firmware requires.** This is worth a real-device or vendor check before go-live; a wrong `TransFlag` produces a device that connects and then uploads nothing — a silent failure that looks like "the integration works but no data arrives".

### 4.4 ATTLOG upload

```
POST /iclock/cdata?SN=BOCK200961014&table=ATTLOG&Stamp=9999
Content-Type: text/plain

<PIN>\t<YYYY-MM-DD HH:MM:SS>\t<Status>\t<VerifyMode>\t<WorkCode>\t<Reserved1>\t<Reserved2>
```

One record per line, tab-separated, **positional**. Confirmed by three independent implementations:

- Go: `attFieldUserID=0, attFieldTimestamp=1, attFieldStatus=2, attFieldVerifyMode=3, attFieldWorkCode=4`, `attMinFields=2`, timestamp accepted as `2006-01-02 15:04:05` **or** a Unix epoch integer ([`types.go`](https://github.com/s0x90/zkteco-adms), `parser.go`).
- PHP: `// Format: PIN, DateTime, Status, VerifyType, WorkCode, Reserved1, Reserved2`, `explode("\t", $line)`, requires ≥4 fields ([`AdmsRequestParser.php`](https://github.com/syofyanzuhad/filament-zkteco-adms)).
- Postman collection: raw tab-separated body against `table=ATTLOG`.

Value semantics, per the ADMS datasheet:

- `Status` (check type): `0`=Check In, `1`=Check Out, `2`=Break Out, `3`=Break In, `4`=Overtime In, `5`=Overtime Out
- `VerifyMode`: `0`=password, `1`=fingerprint, `4`=card, `15`=face, `25`=palm

**Note the discrepancy in the source material.** The widely-copied LinkedIn article (and the datasheet section derived from it) presents ATTLOG as `PIN=1001\tDateTime=…\tVerified=1\tStatus=0` — **key=value pairs**. Every actual parser implementation reads **positional** tab-separated values. The key=value form appears to be an illustrative simplification, not the wire format. ResturantOS parses positionally, which matches the implementations. Also note the field-order conflict: the LinkedIn/`key=value` rendering puts `Verified` before `Status`, while all three parsers put `Status` at index 2 and `VerifyMode` at index 3. ResturantOS follows the parsers. **Unverified against hardware.**

Server reply: `OK`. ResturantOS returns `OK`. ✅

### 4.5 Commands (`getrequest` / `devicecmd`)

From the hardware-probed section of the ADMS datasheet (SpeedFace-V5L-RFID, ZAM180-NF-Ver1.1.17, `User-Agent: iClock Proxy/1.09`):

- Device polls `GET /iclock/getrequest?SN=…` **every 3–8 seconds**.
- Commands are returned as `C:<ID>:<CMD>\n`, several per response.
- The device acknowledges with `POST /iclock/devicecmd`, body `ID=1&Return=0&CMD=INFO`, batched one per line.
- Return codes: `0` success, `-1` unsupported/no data, `-2` file op failed, `-1002` invalid syntax, `-1004` table not supported on this model.
- **`USER ADD` / `USER DEL` are rejected by real firmware (`-1002`)**; the correct forms are `DATA UPDATE USERINFO PIN=…\tName=…\tPrivilege=…\tCard=…` and `DATA DELETE USERINFO PIN=…`. Older community docs (including the LinkedIn article) are wrong on this.
- Accepted commands include `INFO`, `CHECK`, `LOG`, `GET OPTION FROM <key>`, `DATA QUERY USERINFO`, and `Shell <command>` — the last one executes an arbitrary shell command on the device's Linux OS and returns output in a `Content=` field.

That last point is a security consideration for ResturantOS specifically: `DeviceCommandQueueService` is a stub today, but if command queuing is ever exposed to tenant admins, the queue must be an allowlist. A free-text command field is remote code execution on the terminal.

### 4.6 Protocol-level security

There is none worth the name. The ADMS datasheet's own "Limitations" section says the protocol is "Plain HTTP by default; encryption is weak unless forced over HTTPS" and is "Stateless: Each request is standalone, relies on SN + key for identification". A [documented CVE-class issue](https://www.trendmicro.com/vinfo/us/threat-encyclopedia/vulnerability/8131/zkteco-facedepot-7b-10213-and-zkbiosecurity-server-10020190723-long-lasting-token-vulnerability) records that ZKTeco FaceDepot 7B / ZKBioSecurity lack mutual authentication, letting an attacker who can sniff or ARP-spoof obtain a long-lasting token by impersonating the server.

Practical implication: **transport and network are the security boundary**, not the protocol. HTTPS to the gateway (newer firmwares support it), plus per-branch network controls.

---

## 5. Device families — who can push HTTP, who needs an SDK

| Vendor | HTTP push to an arbitrary server? | What it actually needs |
|---|---|---|
| **ZKTeco** (iClock, SpeedFace, ZKTime, SilkBio, K/F/MB series with "Cloud Server / ADMS" menu) | **Yes** — ADMS/iClock, exactly what §4 describes | Server address + port on the device. **This is what ResturantOS implements.** |
| **eSSL** | **Yes, effectively the same protocol.** eSSL rebrands ZKTeco hardware; OSS servers advertise support for both ("push server for devices by eSSL and ZKTeco", [srikant-kumar/iclock-epush-server-docker](https://github.com/srikant-kumar/iclock-epush-server-docker)), and commercial products list both against one endpoint. Field/response differences by firmware are **unverified**. | Same `/iclock/*` server. Test one unit before promising support. |
| **Hikvision** | **Yes, but a different protocol.** ISAPI "listening mode": `PUT /ISAPI/Event/notification/httpHosts/<id>` configures a listening host (url, ipAddress, portNo, protocolType, parameterFormatType JSON/XML, httpAuthenticationMethod); the device then POSTs event payloads to that URL. Capability probe: `GET /ISAPI/Event/notification/httpHosts/capabilities` → `HttpHostNotificationCap`. Polling alternative: `POST /ISAPI/AccessControl/AcsEvent?format=json` with an `AcsEventCond` search. Device API auth is HTTP **Digest** and is clock-sensitive. | A **separate adapter** — different endpoints, JSON/XML payloads, digest auth, a configuration step performed *against* the device. Roughly a second `adms`-sized package. Sources: [Hikvision TPP wiki](https://tpp.hikvision.com/Wiki/ISAPI/Access%20Control%20on%20Person/GUID-0E00BD39-BDB4-4079-A8EE-307A95871C1A.html), [uchkunr/hikvision-best-practices](https://github.com/uchkunr/hikvision-best-practices). |
| **Suprema** (BioStation, BioEntry, FaceStation) | **No.** Devices do not push to an arbitrary HTTP endpoint. | Either the **BioStar 2 server** + its REST API / WebSocket event stream, or the **Device SDK** (Windows DLL / Linux .so, `BS2_ConnectDevice` client mode *or* `OnDeviceAccepted` server mode, real-time callbacks via `BS2_SetDeviceEventListener`), or **G-SDK** — a gRPC "device gateway" process that owns the device connections and exposes Java/C#/Python/Node/Go/C++ clients. Sources: [Suprema KB integration options](https://kb.supremainc.com/knowledge/doku.php?id=en:possible_integration_options_in_biostar_2), [BioStar Device SDK communication API](https://kb.supremainc.com/bs2sdk/doku.php?id=en:communication_api), [G-SDK overview](https://supremainc.github.io/g-sdk/overview/). For ResturantOS this means an **out-of-process sidecar**, which is architecturally the same shape as the already-specified USB bridge agent. |

**Recommendation:** ZKTeco/eSSL is the right and only family to support in v1. Hikvision is a bounded second adapter if a customer demands it. Suprema should be routed through the Mode B agent contract rather than given a first-party adapter.

---

## 6. Pull mode, sync timing, clock skew, duplicates, and identity mapping

### 6.1 Pull mode (the alternative to push)

ZKTeco's older "standalone" protocol is a **proprietary binary protocol over TCP/UDP on port 4370**, in which the *device is the server* and your software connects to it. `fananimi/pyzk` is the de-facto client: `ZK('192.168.1.201', port=4370, …)`, `conn.get_attendance()`, and a `conn.live_capture()` for real-time events. [`adrobinoga/zk-protocol`](https://github.com/adrobinoga/zk-protocol/blob/master/protocol.md) documents the packet format (`CMD_ATTLOG_RRQ` 0x000d, `CMD_CLEAR_ATTLOG` 0x000f, realtime via `CMD_REG_EVENT`) and states explicitly that it covers the standalone protocol, **not** ADMS — do not conflate the two when researching.

Trade-offs versus push:

| | Push (ADMS) | Pull (TCP 4370) |
|---|---|---|
| Network | Device dials out; **no inbound firewall rule** | Server must reach the device: port-forward + static IP or DDNS per branch ([ClockIt PULL setup](https://help.clockit.io/en/articles/1082333-how-to-add-a-biometric-time-and-attendance-device-to-clockit-using-pull-or-adms-push)) |
| Latency | Seconds (`Realtime=1`) | Poll interval — ClockIt polls every 30 min |
| Multi-tenant SaaS fit | Natural | Poor — you would need an outbound connector per branch anyway |
| Library support | None in Java; hand-rolled (this repo) | Python (`pyzk`), no maintained Java client found |
| Windows COM SDK | n/a | `zkemkeeper` ActiveX — Windows-only, unusable from a Linux JVM |

For a multi-tenant cloud ERP, **push is correct** and the existing choice is right. Pull is only worth building as a fallback *inside* the branch-local bridge agent, where it is a LAN call.

### 6.2 Real-time vs batch

The protocol supports both, selected by the handshake block ResturantOS already sends: `Realtime=1` pushes each punch as it happens; `TransTimes`/`TransInterval` drive scheduled batch uploads; `Delay` sets the poll cadence. Devices also buffer locally when the server is unreachable and replay on reconnect — which is exactly why idempotency is not optional. Commercial products expose the same choice (AttendUX offers "Sync Now" plus "automatic syncing every 15 or 30 minutes").

ResturantOS sends `Realtime=1` with `TransTimes=00:00;14:05`, `TransInterval=1`, `Delay=30`, `ErrorDelay=30`. Those values are plausible but were copied from community documentation; only a real device confirms them.

### 6.3 Clock skew

**The device stamps the punch, and its clock is the only clock.** ADMS carries no server-side timestamp reconciliation. Consequences seen in the field: a drifted device puts punches in the wrong shift window; a mismatch of more than a few minutes corrupts late/early calculations.

What the repo does right: `attendance_punches` stores **both** `device_reported_at` and `server_received_at`, so drift is measurable after the fact — `server_received_at - device_reported_at` on a `Realtime=1` device is the drift, and that is the metric to alert on.

What is missing: nothing computes it, and `AttlogLineParser` hardcodes `Asia/Karachi` as the device zone rather than reading it per device. Two concrete additions: a `timezone` column on `attendance_devices`, and a reject/flag threshold (e.g. quarantine any punch whose `device_reported_at` is more than N minutes in the future, or more than M days in the past outside a declared backfill window). Note the ADMS `Shell` command family (§4.5) and the standard `SET OPTION` mechanism could in principle push a time sync to the device, but I did **not** find a verified time-sync command form; NTP on the device is the documented remedy.

### 6.4 Duplicate punches

Two different problems, often conflated:

1. **Protocol-level replay** — the device re-sends a buffered batch after a network blip. Handled correctly: `ON CONFLICT (device_id, device_user_ref, device_reported_at) DO NOTHING`, and no event on a zero-row insert. Verified by `AdmsIngestIT.admsAttlog_parsesIngestsIdempotently_skipsShortLine`, which replays the same body and asserts exactly one row and exactly one `ATTENDANCE_PUNCHED` event.
2. **Human double-punch** — the same employee taps twice in ten seconds. **Not handled anywhere.** Both taps have distinct `device_reported_at` values, so both are stored, and `deriveLateEarly` takes the first IN and last OUT, which absorbs the noise for the late/early case but not for any pairing-based hours calculation. The standard remedy is a per-employee debounce window (ignore a same-type punch within N minutes of the previous one), which belongs in `PunchIngestService` as an explicit, configurable rule.

Note also that the uniqueness key includes `device_id`: the same employee punching the same second on two devices produces two rows. Correct for auditing, and something any hours calculation must be aware of.

### 6.5 Mapping a device user id to an employee

This is the part the repo handles best, and the design is worth preserving verbatim. The device knows a numeric **PIN**; the platform knows an employee UUID. The bridge is `employees.device_user_ref`, unique per tenant, and:

- resolution is a **durable stored mapping**, not a per-punch heuristic;
- an unmapped PIN is **quarantined with its raw line preserved**, never dropped;
- resolving a quarantine writes the mapping, re-ingests the parked punch, and every *subsequent* punch for that PIN auto-resolves — explicitly tested (`AdmsIngestIT.unmappedRef_quarantines_thenResolveEstablishesDurableMapping` asserts no second quarantine appears);
- re-pointing a PIN at a second employee is refused.

The remaining hole is the **enrolment direction**: nothing pushes employees *to* the device, so PINs are assigned by whoever stands at the terminal, and the first punch of every new hire is a quarantine. `DATA UPDATE USERINFO PIN=…\tName=…\tPrivilege=…\tCard=…` through the (currently stubbed) command queue is the documented mechanism to close that loop.

---

## 7. Testing with no physical device

**Yes — completely.** The device is an HTTP client sending plain text; anything that speaks HTTP is a device simulator. There is no handshake secret, no binary framing, no TLS client cert. Three tiers, cheapest first.

### 7.1 Tier 1 — `curl` against a locally running hr-service (2 minutes)

Start the infra and the service:

```bash
docker compose -f deploy/docker-compose.yml up -d postgres redis rabbitmq
export JAVA_HOME=$(/usr/libexec/java_home -v 25)   # the build enforces JDK 25
mvn -pl services/hr-service spring-boot:run        # listens on 8088 per application.yml
```

Register a device and capture the one-time token — via the gateway (`server.port: 8080`), with a JWT carrying the `hr.attendance.manage` authority (`AttendanceDeviceController.java:40`):

```bash
curl -sX POST http://localhost:8080/api/v1/hr/devices \
  -H "Authorization: Bearer $JWT" -H 'Content-Type: application/json' \
  -d '{"serialNo":"AC123456789","model":"ZKTeco K40","connectionMode":"NETWORK_ADMS"}'
# → { "data": { "device": {...}, "deviceToken": "<TOKEN>", "serverUrl": "..." } }
```

Then be the device. Hit hr-service directly on 8088 to isolate the adapter, or the gateway on 8080 to also exercise routing and rate limiting:

```bash
SN=AC123456789; T=<TOKEN>; BASE=http://localhost:8088

# 1. Boot handshake — exactly what firmware sends, minus the token
curl -i "$BASE/iclock/cdata?SN=$SN&options=all&pushver=2.4.0&language=69"

# 2. Handshake the way this implementation requires it
curl -i "$BASE/iclock/cdata?SN=$SN&token=$T&options=all"

# 3. Attendance upload — REAL tab characters matter; $'…' gives them
curl -i -X POST "$BASE/iclock/cdata?SN=$SN&token=$T&table=ATTLOG&Stamp=9999" \
     -H 'Content-Type: text/plain' \
     --data-binary $'1001\t2026-06-15 09:30:00\t0\t1\t0\t0\t0\n1002\t2026-06-15 09:31:12\t0\t15\t0\t0\t0\n'

# 4. Replay the identical body — must stay idempotent, no second event
curl -i -X POST "$BASE/iclock/cdata?SN=$SN&token=$T&table=ATTLOG" \
     -H 'Content-Type: text/plain' \
     --data-binary $'1001\t2026-06-15 09:30:00\t0\t1\t0\t0\t0\n'

# 5. Command poll
curl -i "$BASE/iclock/getrequest?SN=$SN&token=$T"

# 6. Command ack
curl -i -X POST "$BASE/iclock/devicecmd?SN=$SN&token=$T" \
     -H 'Content-Type: text/plain' --data-binary $'ID=1&Return=0&CMD=INFO\n'

# 7. Mode B (USB bridge agent) ingest
curl -i -X POST "$BASE/internal/attendance/ingest" -H 'Content-Type: application/json' \
  -d "{\"serial\":\"$SN\",\"token\":\"$T\",\"employeeRef\":\"1001\",\"punchType\":\"OUT\",\"punchedAt\":\"2026-06-15T17:00:00Z\"}"
```

Use `--data-binary`, not `-d`: `-d` strips newlines, which collapses a multi-line ATTLOG batch into one unparseable line. Use `$'…'` quoting so `\t` and `\n` become real bytes. This is the same technique the `zkteco_http_listener` project documents for its own smoke test (`curl -X POST ".../cdata?SN=TESTSN" --data-binary $'…'`).

Verify in Postgres:

```sql
SELECT device_user_ref, punch_type, device_reported_at, server_received_at,
       server_received_at - device_reported_at AS skew
  FROM attendance_punches ORDER BY server_received_at DESC LIMIT 10;
SELECT * FROM attendance_quarantine WHERE status = 'PENDING';
SELECT serial_no, last_seen_at, is_active FROM attendance_devices;
```

### 7.2 Tier 2 — an HTTP-level integration test (the gap that matters)

`AdmsIngestIT` invokes the controller as a Java method, so it cannot see any of the four defects in §3. Add a sibling that goes over the wire. The exact shape, verified working this session:

```java
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class AdmsHttpContractIT extends HrTestBase {

    @LocalServerPort int port;                    // org.springframework.boot.test.web.server.LocalServerPort
    // TestRestTemplate is NOT at org.springframework.boot.test.web.client on Boot 4.0.7 —
    // use java.net.http.HttpClient, and pin it to HTTP/1.1:
    private final HttpClient http =
            HttpClient.newBuilder().version(HttpClient.Version.HTTP_1_1).build();
    ...
}
```

Two traps, both hit and solved during this research:

1. **Pin `HttpClient` to HTTP/1.1.** The default client attempts an HTTP/2 upgrade against this Tomcat and every request fails with `java.io.IOException: HTTP/1.1 header parser received no bytes` — which looks exactly like "the server is down" and cost several runs to diagnose.
2. **`spring-boot-starter-parent` is 4.0.7** (`pom.xml:15`); `LocalServerPort` lives at `org.springframework.boot.test.web.server.LocalServerPort` and `TestRestTemplate` is not on the classpath at its Boot 3 coordinates.

Assertions that would have caught each §3 defect:

| Assertion | Catches |
|---|---|
| `GET /iclock/cdata?SN=…&options=all` (no token) → **401** | Defect A + B |
| `GET /iclock/cdata?SN=…&token=wrong` → **401**, not 500 | Defect B |
| ATTLOG POST with `Content-Type: application/x-www-form-urlencoded` → row is written | Defect C |
| `GET /iclock/getrequest` with empty queue → body equals `OK` | Defect D |
| Handshake body contains `GET OPTION FROM: <sn>` and `Realtime=1` | Handshake regressions |
| ATTLOG with a Unix-epoch timestamp → row written **or** quarantined, never silently dropped | §3.5 |
| ATTLOG with a 3-field line → not silently dropped | §3.5 |

Run it exactly as the existing ITs run (failsafe, `*IT.java`):

```bash
export JAVA_HOME=$(/usr/libexec/java_home -v 25)
export TESTCONTAINERS_RYUK_DISABLED=true
export TESTCONTAINERS_HOST_OVERRIDE=$(colima list | awk 'NR==2{print $NF}')   # colima only
mvn -o -pl services/hr-service verify -Dit.test='AdmsHttpContractIT' \
    -Dsurefire.failIfNoSpecifiedTests=false -Dtest='none'
```

(The two Testcontainers variables are documented at `scripts/DEV-STACK-RUNBOOK.md:402-440`; without them the run fails on colima for reasons unrelated to this code.)

### 7.3 Tier 3 — a device simulator

**No dedicated ZKTeco *device* simulator exists** that I could find; every OSS project in this space is a *server*, not a device. That is fine — the device side is trivial to write. A 30-line script that loops on the real cadence gives you soak/duplicate/skew testing:

```python
# adms_device_sim.py — pretends to be an iClock terminal
import time, requests, datetime, random
BASE, SN, TOKEN = "http://localhost:8088", "AC123456789", "<TOKEN>"
q = {"SN": SN, "token": TOKEN}

print(requests.get(f"{BASE}/iclock/cdata", params={**q, "options": "all",
                   "pushver": "2.4.0", "language": "69"}).text)      # handshake
while True:
    now = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    pin = random.choice(["1001", "1002", "9999"])                    # 9999 -> quarantine
    line = f"{pin}\t{now}\t0\t1\t0\t0\t0\n"
    print(requests.post(f"{BASE}/iclock/cdata", params={**q, "table": "ATTLOG"},
                        data=line.encode(), headers={"Content-Type": "text/plain"}).text)
    print(requests.get(f"{BASE}/iclock/getrequest", params=q).text)  # poll, 3-8s in reality
    time.sleep(5)
```

Useful variants to run against it: send the same batch twice (idempotency), send a PIN with no mapping (quarantine), set the simulator clock 20 minutes ahead (skew), fire 200 requests in a minute through the gateway (per-device rate limit), and flip `Content-Type` (Defect C).

The cross-check in the other direction — "is our server behaving like a real ADMS server?" — is to run one of the reference servers and diff responses: [`s0x90/zkteco-adms`](https://github.com/s0x90/zkteco-adms) (Go, MIT, has a `cmd/probe` tool and a hardware-derived datasheet) is the best reference, with [`syofyanzuhad/filament-zkteco-adms`](https://github.com/syofyanzuhad/filament-zkteco-adms) (PHP) as a second opinion.

### 7.4 What still cannot be verified without hardware

Be honest about the boundary. No amount of simulation confirms:

- which `TransFlag` encoding the target firmware accepts (§4.3);
- whether an empty `getrequest` body is tolerated (§3.4);
- what `Content-Type` the target firmware actually sends on ATTLOG (§3.3);
- whether the device requires `/iclock/registry` or `/iclock/test` (§4.2);
- whether any firmware offers *any* way to carry a per-device secret (§3.1) — the decisive question for the whole design;
- the real field count and ordering emitted by the specific model (§4.4).

Every one of these is answered by **one afternoon with one physical unit**, and a ZKTeco K40/MB20-class terminal is inexpensive. Given that the server side is already built and tested, buying a single device is the highest-value next expenditure on this feature — the remaining risk is entirely in what firmware does, not in what the code does.

---

## 8. Recommended order of work

1. **Decide the device-authentication story (§3.1).** Everything else is cosmetic until a real device can authenticate. This is a design decision, not a coding task, and it needs the customer's network topology.
2. **Fix Defect B** — `@ExceptionHandler(DeviceAuthException.class)` in `HrExceptionHandler`, returning 401, pinned by a MockMvc test next to `TotpRequiredResponseTest`. Ten minutes; stops stack-trace log flooding at 3–8 s per unknown device.
3. **Add `AdmsHttpContractIT` (§7.2)** with the assertion table above. This is the artifact that keeps the protocol honest.
4. **Fix Defect C and D** — read the body from the input stream (or skip form parsing on `/iclock/**`); return `OK` from an empty command queue.
5. **Set `restaurantos.hr.device-server-url`** so registration stops printing `REPLACE-WITH-GATEWAY-HOST`, and add the device-registration screen the frontend lacks.
6. **Correct or remove the `FEATURE_HR` claim on `/iclock/**`** (§3.5) — an inert gate that three comments describe as active is worse than no gate.
7. **Per-device timezone + a clock-skew alert** off `server_received_at - device_reported_at`; **stale-device alert** off `last_seen_at`.
8. **Buy one device.** Then, and only then, close out §7.4.
