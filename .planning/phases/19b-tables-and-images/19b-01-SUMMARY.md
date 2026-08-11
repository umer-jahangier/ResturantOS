---
phase: 19b-tables-and-images
plan: 19b-01
status: complete
completed: 2026-08-11
closes: [GA-005, GA-014, GA-015]
owns: services/pos-service
also_touches:
  - services/file-service
  - services/auth-service (changelog 083 only)
  - frontend/components/menu
  - frontend/app/(tenant)/app/tables
  - frontend/lib (pos + files layers)
  - scripts/local-service-env.sh (one-line env fix, see Scope exceptions)
---

# Phase 19b Plan 01: Dining tables and menu-item images — Summary

Dining tables can now be created, renamed, re-capacitied, sectioned, retired and restored — and
a waiter can pick one mid-order, which is what makes the feature finished rather than merely
present. Menu items gained a picture: a Flyway column, a magic-byte-enforced upload in
file-service, and the product's first file input.

---

## The two halves were at different stages, and that shaped everything

| | Tables | Images |
|---|---|---|
| Before | half-built — entity, table, `GET`, and a **wired but permanently empty picker** | nothing at all on the menu side |
| `POST /api/v1/pos/tables` | **405** | n/a |
| Missing | create path, catalogue admin, UI | column, API, upload, UI |

The table picker was never broken. It was reading a catalogue nothing could write to, so every
tenant in the product had zero tables. This phase filled the catalogue and deliberately did
**not** touch the order↔table binding, which already worked (`CreateOrderRequest.tableId →
Order.tableId → TableService.syncStatusForOrder`).

---

## Measured: before → after (live stack, gateway :8080)

```
BEFORE                                          AFTER
POST /api/v1/pos/tables            → 405        → 201  (table created)
GET  /api/v1/pos/tables            → []         → 5 tables, grouped by section
menu item keys: no image key       → imageFileId + imageUrl on every item
grep -c 'type="file"' frontend/**  → 0          → 1 (the pattern-setting first one)
```

---

## Decisions

### `pos.tables.admin` is a NEW permission, not `pos.tables.manage`

`pos.tables.manage` already existed and **WAITER holds it** — deliberately, since changeset 055:
"Without it a waiter cannot seat a table or attach an order to one." Hanging catalogue CRUD off
it would have handed every waiter the ability to rename and retire the restaurant's tables
mid-shift. Verified live, both directions:

| Verb | Permission | WAITER (live) | MANAGER (live) |
|---|---|---|---|
| List tables, seat/release | `pos.tables.manage` | `200` / `200` | `200` |
| Create / rename / retire | `pos.tables.admin` | **`403`** | `201` / `200` |
| Catalogue view (`includeInactive=true`) | `pos.tables.admin` | **`403`** | `200` |

The `includeInactive` flag is gated **inside the service**, not by a controller `@PreAuthorize`.
A method-level annotation would have to be the *weaker* of the two permissions for the waiter's
picker to keep working, which would leave the flag itself as an unguarded escalation.

### Deactivate, never delete

`orders.table_id` references these rows; a closed order must keep naming the table it was served
at. There is no `DELETE` on the controller and there will not be one. A new `is_active` column
separates *catalogue* state from `status`, which is *runtime* state written by the order
lifecycle — conflating them would make an occupied table un-retirable and a retired table flip
back to AVAILABLE when its last order closed.

Retiring an OCCUPIED table is refused, because it would strand the party sitting at it:

```
PATCH /tables/{id}/deactivate → 409
"Table H1 is OCCUPIED — close or move its order before retiring it."
```

### Section is a label, not an entity

A nullable `VARCHAR(50)`, grouped in the UI, with a datalist of existing values so a manager does
not invent "Rooftop" three ways. Modelling it as its own table would be a second catalogue to
CRUD before the first one is usable.

### `image_file_id`, not `image_url`

The DB holds an identity; the API derives the location (`/api/v1/files/{id}/download`). Persisting
a URL would bake a route into every row and go stale the day the route changes.

---

## Server-side image enforcement — the part a client cannot be trusted with

`Content-Type` on a multipart part is client-supplied and forged with one `curl` flag. So
`ImageUploadPolicy` reads **magic bytes** (JPEG / PNG / WebP; RIFF+WEBP checked as a pair, since
WAV and AVI also start "RIFF") and caps size at 2 MiB before a byte reaches MinIO. The **sniffed**
type is what gets stored, so a forged label cannot be echoed back to a browser by `download()`.

Verified live against the running file-service:

```
real PNG,      purpose=MENU_ITEM_IMAGE  → 201
renamed EXE,   labelled image/png       → 422 INVALID_IMAGE
   "That file is not a JPEG, PNG or WebP image. Renaming a file does not change
    what it is — re-export it as an image."
3 MB PNG,      purpose=MENU_ITEM_IMAGE  → 422 INVALID_IMAGE
   "Image is 3.0 MB. The maximum is 2.0 MB — try a smaller photo."
same EXE,      NO purpose               → 201   (policy is opt-in by design)
```

The client-side check in the form is a **courtesy** and is commented as one — it reads
`File.type`, which renaming defeats entirely.

### Belt and braces: pos-service re-validates the reference

A client can POST any UUID as `imageFileId`; the upload endpoint is not the only way one arrives.
pos-service resolves it against a new `GET /internal/files/{id}` (shared-secret guarded) and
refuses to persist anything that does not resolve **inside the caller's tenant** as a real image.

```
internal GET, own tenant      → 200
internal GET, foreign tenant  → 404   (identical to "no such file" — cannot be used to probe)
internal GET, bad/no secret   → 403
menu item with bogus image id → 409 "That image is no longer available. Upload it again."
```

Validation is **fail-closed** (an unreachable file-service blocks the save rather than writing an
unverified cross-tenant reference); cleanup is **fail-open** (it runs after a committed save, so
a storage outage must not surface as a menu error).

---

## What happens to the stored object — stated plainly

| Action | `image_file_id` | The file in file-service |
|---|---|---|
| **Replace** a picture | points at the new file | previous one **soft-deleted, quota released** |
| **Remove** a picture | set to `NULL` | **soft-deleted, quota released** |
| **Deactivate** a menu item | untouched | **untouched** — reactivation must restore the picture |
| **Delete** a menu item (`deleteItem`, a soft delete) | **retained on the row** | **not deleted** |

The last row is the one a reviewer should ask about. `deleteItem` sets `deleted_at` and clears
`active`; the row stays. Reversibility is the *only* reason it is a soft delete, and a soft
delete that hard-deletes its attachments is not reversible — restoring the item would bring back
a row pointing at a file that no longer resolves. Nothing in the product hard-deletes a menu item
today; if that is ever added, releasing the image is that change's job.

All four verified live (404 = released, 200 = retained):

```
replace  → old 404, new 200
price-only edit (id round-tripped) → picture SURVIVES
deactivate → reactivate           → file still 200
remove (null)                     → 404
```

---

## Forced RLS

Every new `DiningTableRepository` query carries an explicit `tenantId` predicate **in the JPQL**,
in addition to RLS. Under `FORCE ROW LEVEL SECURITY` an unscoped query returns **zero rows rather
than erroring**, so a plumbing gap looks like "no data" and gets triaged as one for a week. The
predicate also survives independently of the `app.current_tenant_id` GUC.

Testcontainers runs Postgres as a **superuser and bypasses RLS entirely**, so a green IT proves
nothing about the policy. `TableCatalogueIT.foreignTenantRowsAreInvisibleEvenWithRlsBypassed`
therefore asserts the half a superuser *can* observe: with RLS inert, a foreign tenant's row is
still excluded because the query excludes it. `RlsForcedInvariantIT` (17b) still passes — the new
columns live on an already-FORCEd table and no policy was changed.

---

## Defects found and fixed along the way

**1. `createOrder` bound `tableId` with ZERO validation.** A bare `order.setTableId(request.tableId())`
— any UUID accepted, including a sibling branch's table or one that never existed. Unreachable in
practice only because no tenant had any tables; this phase makes it reachable. Now the table must
exist in the caller's tenant **and** branch and still be in service.

**2. `ResponseStatusException` → 500, twice.** shared-lib's `GlobalExceptionHandler` has no mapping
for it, so its catch-all turned both the image rejection and the internal 404 into
`INTERNAL_ERROR / "An unexpected error occurred"`. The upload *was* correctly refused — nothing
stored — but the carefully-worded reason never reached the user, who saw a server crash for
something fixable in ten seconds. Replaced with a dedicated `InvalidImageException` (mapped to 422
by a controller-local handler) and a returned-not-thrown 404.

**3. axios silently discards the file.** `apiClient` defaults to `Content-Type: application/json`,
and axios *obeys* it for a `FormData` body — `transformRequest` does
`return hasJSONContentType ? JSON.stringify(formDataToJSON(data)) : data`. A `File` has no
enumerable own properties, so the request that leaves the browser is `{"file":{}}` and the server
answers **2xx with no file in it**. `headers: {"Content-Type": undefined}` is therefore
load-bearing, and `__tests__/pos/file-repository-upload.test.ts` fails the moment it is removed.

**4. An authenticated image cannot be an `<img src>`.** The download route is gated on `file.view`,
so a plain `<img>` at it returns 401 and the broken-image glyph — which reads as "the upload
failed". `useAuthenticatedImage` fetches the bytes through the authenticated client and hands the
DOM an object URL, revoking it on unmount and on source change.

**5. `local-service-env.sh` never exported `PLATFORM_ADMIN_SERVICE_URI`.** file-service reads that
name; the script exported `PLATFORM_ADMIN_URI`. Every upload died in the quota check with
`UnknownHostException: platform-admin-service`, surfaced as a bare 500. Nobody had hit it because
**nothing in the product had ever called file-service** — this is its first caller.

**6. Preview only appeared on success.** A 2 MB photo over restaurant wifi is a visible wait, and
showing only "Uploading…" reads as "my click did not register". The preview is now optimistic and
rolls back on failure.

**7. `FieldLabel` needs react-hook-form context.** The image field is deliberately not an RHF field
(the upload already happened; what remains is an id), and using `FieldLabel` there threw
`Cannot destructure property 'getFieldState'`. Replaced with a plain `<label htmlFor>` + `FieldHelp`
— which also gives the file input a proper accessible name.

---

## Verification

### Automated

| Suite | Result |
|---|---|
| pos-service ITs (28 classes, incl. `RlsForcedInvariantIT`, `AssignTableIT`) | **138 passed** |
| `TableCatalogueIT` (new) | **16 passed** |
| `ImageUploadPolicyTest` (new) | **13 passed** |
| Frontend unit/component (74 files) | **635 passed** |
| Browser E2E `e2e/tables-and-menu-images.spec.ts` (new) | **3 passed** |
| `tsc --noEmit` / `eslint` | clean (0 errors) |

### Real browser — `.planning/phases/19b-tables-and-images/shots/`

| Shot | What it shows |
|---|---|
| `03-tables-created` | Tables grouped by Garden / Rooftop / Terrace with seat counts and live status |
| `04-pos-table-list-open`, `04b-pos-table-selected` | the new table **picked in the POS terminal** — the gap actually closed |
| `05-tables-retired` | retired table hidden by default, visible under "Show retired" with a Retired badge |
| `06/07-waiter-*` | no Tables nav entry, and no management actions even at the URL |
| `09-menu-image-forged-rejected` | the server's magic-byte refusal shown verbatim in the form |
| `10-menu-image-preview` | preview with Replace / Remove |
| `11`, `12-thumbnails-settled` | thumbnails render from `blob:` URLs; items without a picture get a calm placeholder |

Browser-confirmed counts on the settled menu screen: **2 `<img>` (both `blob:`), 10 placeholders,
0 errored, 0 console errors.**

Because MSW cannot return a response for an intercepted **multipart XHR under jsdom** (the handler
runs, the promise never settles), the upload happy path is proven **only** in the browser. The
jsdom tests assert the request shape instead, and say so.

---

## Scope exceptions (declared)

- `frontend/components/shared/sidebar-nav-items.ts` — one nav entry, without which the Tables
  screen is unreachable. Additive; another agent edited this file concurrently and both changes
  coexist.
- `scripts/local-service-env.sh` — one export (defect 5). Without it the feature cannot work in
  local dev at all.
- `frontend/lib/api-client/schemas/file.schema.ts`, `lib/repositories/file.repository.ts`,
  `lib/hooks/files/` — new Layer 1/2/3 files for the upload. No other agent has a file surface.
- `frontend/__tests__/pos/` — the established domain convention for POS tests; the vitest glob
  does not cover `app/**/__tests__`, and widening a shared config was the worse option.

## Deliberately not done

- No gateway change of any kind; `WS_UPGRADE_PATHS` untouched.
- No change to the order↔table binding, which already worked.
- Abandoned uploads (file chosen, dialog cancelled) are orphaned. Bounded by the 2 MiB cap and the
  tenant quota; a sweeper is a separate concern, not a form's job.
- `ALLOWED_IMAGE_TYPES` is duplicated in pos-service and file-service. Two services in two
  deployables; a shared constant would mean a shared-lib release to change an image format.
