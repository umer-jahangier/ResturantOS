---
phase: 19b-tables-and-images
status: executed
created: 2026-08-07
closes: [GA-005, GA-014, GA-015]
owns: services/pos-service
also_touches: [services/file-service, services/auth-service (changelog only), frontend/components/menu, frontend/components/pos, frontend/lib]
---

# Phase 19b — Dining-table management and menu-item images — CONTEXT

## Why this phase exists

Two gaps the user reported in their own words:

> "I didn't find any way to add tables"
> "there should be a picture upload option for menu item"

Both are real. Neither is the same kind of work, and the difference is the whole plan.

## Measured baseline — 2026-08-07, live stack, before any change

Logged in as `manager@terrace.local` through the gateway on `localhost:8080`,
branch `34cd6f62-6b8f-4ebf-8e16-d0d57b5e4a03`.

```
POST /api/v1/pos/tables            → 405   (no handler exists)
GET  /api/v1/pos/tables            → {"data":[]}
GET  /api/v1/pos/menu/items        → 8 items, key set:
     active, basePricePaisa, categoryId, categoryName, description, id,
     kdsStation, name, overridePricePaisa, stationId, taxRateCode, taxRatePct
     — no image key at any layer
GET  /api/v1/files                 → 200   (file-service is alive and unused)
```

`grep -c 'type="file"' frontend/{app,components}` → **0**. This phase ships the
product's first file input, so it sets the pattern.

## The two halves are at different stages

### 1. Dining tables — half-built, and the built half works

| Layer | State before |
|---|---|
| `dining_tables` table | **Exists** — `V1__pos_schema.sql:115-129`, with `floor_plan_x/y/shape` |
| `DiningTable` entity | **Exists** |
| `DiningTableRepository` | **Exists** — `findByBranchId`, `findByIdAndBranchId` |
| `TableController` | **Partial** — `GET /`, `PATCH /{id}` (status only), `GET /{id}/active-order` |
| `TableService` | **Partial** — `listByBranch`, `updateStatus`, `getActiveOrderForTable`, `syncStatusForOrder` |
| Create path | **Absent** — no endpoint, no service method, no DTO, no UI |
| `Order.tableId` | **Exists** — `Order.java:44`, plus `CreateOrderRequest.tableId`, `OrderDto.tableId`, `AssignTableRequest` |
| Table picker in POS | **Exists** — `components/pos/table-select-combobox.tsx`, already wired |

**Decision: do not duplicate `Order.tableId`.** The order side is finished. A table
selected in the terminal already flows `CreateOrderRequest.tableId → Order.tableId →
TableService.syncStatusForOrder`. The only reason the picker is useless today is that
the catalogue behind it is empty. This phase fills the catalogue; it does not touch
the order↔table binding.

**Decision: `deactivate`, not `delete`.** `dining_tables` has no `is_active` column and
`DiningTable` has no `active` field — only `status` (AVAILABLE/OCCUPIED/NEEDS_BUSSING),
which is *runtime service state*, not catalogue state. Conflating "Table 7 is currently
occupied" with "Table 7 no longer exists in this restaurant" would make an occupied
table un-hideable and a retired table look available. A new `is_active` column separates
the two. Hard delete is not offered: `orders.table_id` points at these rows and a closed
order must keep naming the table it was served at.

**Decision: a new permission, `pos.tables.admin`.** `pos.tables.manage` already exists —
and **WAITER holds it** (changeset `055`, deliberately: "Without it a waiter cannot seat a
table or attach an order to one"). Reusing it for catalogue CRUD would hand every waiter
the ability to rename and retire tables. The two verbs are genuinely different:

| Verb | Permission | WAITER | CASHIER | MANAGER |
|---|---|:-:|:-:|:-:|
| Seat/release a table, attach an order | `pos.tables.manage` | ✅ | ✅ | ✅ |
| Create / rename / re-capacity / retire a table | `pos.tables.admin` (**new**) | ❌ | ❌ | ✅ |

Granted to OWNER, TENANT_ADMIN, MANAGER. Asserted excluded for WAITER and CASHIER.

**Decision: sections are a plain label, not an entity.** "Assign to a branch/section" —
branch is already a hard FK-ish column (`branch_id`, NOT NULL, and every read is
branch-scoped). A *section* ("Rooftop", "Garden", "Hall") is a grouping label a manager
types. Modelling it as its own table would be a second catalogue to CRUD before the
first one is usable. A nullable `section VARCHAR(50)` on `dining_tables`, grouped in the
UI, delivers the whole user-visible benefit. Promote it later if floor plans need it.

### 2. Menu-item images — nothing exists on the menu side, and the uploader is complete

| Layer | State before |
|---|---|
| `menu_items` image column | **Absent** |
| `MenuItem` entity field | **Absent** |
| `MenuItemDto` / request DTOs | **Absent** |
| `FileController` upload | **Complete** — multipart → MinIO, quota-enforced, `file.upload` gated |
| Any caller of `/api/v1/files` | **Zero** across `frontend/{app,components,lib}` |

**Decision: store the file id, derive the URL.** `menu_items.image_file_id UUID` only.
`imageUrl` is computed in the DTO as `/api/v1/files/{id}/download`. Persisting a URL
would bake a route into 78 rows and go stale the day the route changes.

**Decision: server-side enforcement is content sniffing, not `Content-Type`.**
`Content-Type` on a multipart part is client-supplied and trivially forged — a
`.exe` renamed and labelled `image/png` passes any header-only check. file-service
gains an `ImageUploadPolicy` that reads the **magic bytes** and rejects anything that
is not genuinely JPEG / PNG / WebP, plus a 2 MiB cap enforced before the bytes reach
MinIO. Only requests carrying `purpose=MENU_ITEM_IMAGE` are held to it, so invoice
scans and other existing (nonexistent, but future) uploads are unaffected.

**Decision: pos-service re-validates the reference (belt and braces).** A client could
POST a menu item with an `imageFileId` pointing at a foreign or non-image file. Before
persisting, pos-service calls file-service's new `GET /api/v1/files/{id}` metadata
endpoint and rejects the save unless the file resolves **inside the caller's tenant**
and has an allowed image content type. This mirrors the 17b belt-and-braces posture:
never rely on a single layer to hold a boundary.

**Decision: what happens to the object when the item is deleted.** Stated plainly
because it is the question a reviewer should ask:

- **Replace / remove an image** → pos-service soft-deletes the *previous* file via
  file-service (`DELETE /api/v1/files/{id}`), which releases the tenant's storage
  quota. The MinIO object itself is retained, exactly as file-service's existing
  delete contract already documents for compliance.
- **Deactivate a menu item** → nothing happens to the image. Deactivation is
  reversible; a reactivated item must come back with its picture.
- **Delete a menu item** (`deleteItem`, a soft delete: `deleted_at` set, `active`
  false) → `image_file_id` is **retained on the row** and the file is **not**
  deleted. A soft delete that hard-deletes its attachments is not reversible, and
  reversibility is the only reason it is a soft delete. Nothing in the product hard
  deletes a menu item today; if that is ever added, releasing the image is that
  change's job, and this is the note that says so.

## Constraints honoured

- **Forced RLS (17b).** All 16 `pos_db` tables run `FORCE ROW LEVEL SECURITY`. Under
  FORCE an unscoped query returns **zero rows rather than an error**, so the failure
  mode is "the screen looks empty" — indistinguishable from "there is no data". Every
  new repository method therefore carries an **explicit `tenant_id` predicate in the
  JPQL** in addition to RLS. `RlsForcedInvariantIT` already fails the build if a new
  table ships `ENABLE` without `FORCE`; the new columns live on an existing forced table.
- **Testcontainers proves nothing about tenancy.** Its Postgres is a superuser and
  bypasses RLS entirely. New integration tests therefore assert the tenant predicate at
  the *query* level (a foreign-tenant row is invisible because the JPQL excludes it),
  which is the half that a superuser container can actually observe.
- **Money is BIGINT paisa.** Nothing in this phase touches money.
- **`WS_UPGRADE_PATHS` untouched.** No gateway change of any kind.
- **Phase 20 tokens only.** No new colours; `bg-muted`, `text-muted-foreground`,
  `border-input`, `bg-success/15 text-success`, etc.
- **`QueryBoundary` on every fetching screen.** The new Tables screen and the amended
  Menu Items screen both route error → loading → empty → data through it.
- **4-layer boundary.** New Layer-2 `file.repository.ts`, new Layer-3
  `lib/hooks/files/use-file-upload.ts`. No component imports a repository.

## Scope note

`services/pos-service` is owned exclusively by this phase. Two other agents are working
in `frontend/app/(tenant)/` and `frontend/app/(platform)/`. Frontend work here is
confined to the **menu** and **table** screens plus the shared `lib/` layers, with one
declared exception: a single nav entry, without which the new Tables screen is
unreachable. `services/file-service` and one `services/auth-service` changelog file are
also touched — neither is claimed by another agent, and both are unavoidable
(server-side image enforcement, and the new permission code).
