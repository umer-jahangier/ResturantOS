-- V003__business_date_realignment.sql
--
-- 37-03 / closes 22b defect D-7.
--
-- WHAT THIS MOVES, AND WHAT IT DOES NOT
--
-- It moves 73 sales facts from business_date 2026-08-07 to 2026-08-06. It changes NO money
-- column. Every money column is copied verbatim by the INSERT ... SELECT below, and
-- scripts/e2e/phase32-business-date-reconciliation.sh asserts the sum of every money column across
-- the whole table is byte-identical before and after. If those sums differ by one paisa, this
-- migration is wrong and must be reverted.
--
-- WHY THESE ROWS, AND WHY THIS DATE
--
-- The authority for a sale's trading day is the general ledger, NOT a recomputation. pos-service
-- resolves the day once as (closedAt - 4h) in UTC, checks the accounting period against it, and
-- puts it on the ORDER_CLOSED event; finance-service dates the journal entry from that same field.
-- finance and pos therefore cannot disagree. reporting-service re-derived the day from closedAt in
-- the BRANCH's timezone; for a UTC+5 branch the two formulas diverge for anything closed between
-- 23:00Z and 04:00Z. That is the whole defect, and it is fixed at source in OrderClosedConsumer.
--
-- The correct date for each row below is the entry_date of the ORDER_REVENUE journal entry whose
-- source_id is that order. Reproduce the list with:
--
--     python3 scripts/ops/phase37-generate-business-date-realignment.py --json
--
-- which reads finance_db as finance_user with the tenant GUC set on the SAME connection (every
-- table there is FORCE row-level security; a superuser read would return every tenant's rows and
-- prove nothing about what the service sees), and compares against clickhouse_analytics.
--
-- Output at time of authoring (2026-08-11):
--     sales_order_facts rows: 83
--     ORDER_REVENUE journal entries across 12 tenant(s): 83
--     agree with the ledger : 10
--     need realignment      : 73
--     unmatched (LEFT ALONE): 0
--     moves: 2026-08-07 -> 2026-08-06   73 orders   11,010,720 paisa
--
-- 11,010,720 total_paisa less 1,518,720 tax_paisa = 9,492,000 paisa of revenue, which is the exact
-- figure 22b's D-7 reported. Independent corroboration, not a coincidence.
--
-- UNMATCHED ORDER IDS: NONE. Every one of the 83 facts has a matching ORDER_REVENUE journal entry.
-- Had any lacked one, it would be listed here and LEFT WHERE IT IS. A fact whose ledger
-- counterpart cannot be found is a second, different defect, and guessing its date to make a total
-- look tidy is precisely what D-37-05 forbids.
--
-- WHY INSERT + DELETE RATHER THAN UPDATE
--
--     ENGINE = ReplacingMergeTree
--     PARTITION BY toYYYYMM(business_date)
--     ORDER BY (tenant_id, branch_id, business_date, order_id)
--
-- business_date is in the sorting key, and ClickHouse refuses to mutate a sorting-key column. So
-- the corrected rows are inserted first and the superseded rows are deleted afterwards, by their
-- full sort key. Both dates fall in partition 202608, so no partition is created or dropped.
--
-- sales_item_facts is realigned in lockstep. It carries its own business_date and is NOT mentioned
-- in the 37-03 plan, but leaving 104 item rows on 2026-08-07 while their order headers move to
-- 2026-08-06 would desynchronise every per-item report -- including the COGS and margin work in
-- 37-07 and 37-10, which joins the two on (order_id, business_date). Moving one without the other
-- would replace a visible defect with a subtler one.
--
-- RE-RUNNABILITY
--
-- Safe to re-run. The INSERT selects only rows still sitting on the wrong date, so a second run
-- inserts nothing; the DELETE is likewise scoped and matches nothing the second time.

-- ── 1. sales_order_facts: insert corrected rows ──────────────────────────────────────────────
INSERT INTO clickhouse_analytics.sales_order_facts
SELECT
    tenant_id,
    branch_id,
    toDate('2026-08-06') AS business_date,   -- the ONLY changed column
    order_id,
    order_no,
    order_type,
    customer_id,
    subtotal_paisa,
    discount_paisa,
    service_charge_paisa,
    tax_paisa,
    total_paisa,
    till_session_id,
    cashier_id,
    closed_at,
    event_id
FROM clickhouse_analytics.sales_order_facts
WHERE business_date = toDate('2026-08-07')
  AND order_id IN (
    '04324d1f-761a-44ad-9d41-620c39725ae8',
    '06ace961-23ea-4aae-bcce-6832f793f4e4',
    '0bf1b8ea-d276-48bc-a71b-80dbad71ac26',
    '1086ab5f-1711-478b-bd6d-16e5145958df',
    '138a2eca-fc6c-4412-88b7-283ef3bface3',
    '17b877c6-5061-4143-adf5-e8ed447ae217',
    '18ac9b46-97b8-4a9e-a945-7e5776235c3c',
    '1b459076-c0d4-42e5-8b17-287cdc235413',
    '21301a15-eb1f-4954-8598-a16788331f53',
    '213a0296-7a83-4bc3-b480-f724a154ec9a',
    '23182fc4-81dc-4440-9316-841daa104b88',
    '240d6bfd-7ca9-48ac-98a3-a32f928ccf31',
    '26b0c03d-e616-41b4-bb36-229ebae4b5a2',
    '2d22f2d7-6141-43f6-b37a-acf17f040616',
    '309ff29a-cb10-45f4-b1c7-9e28c6edd9ab',
    '31a52625-a22a-47c5-bc3e-04887a8f64df',
    '336c318e-f8d1-45de-9970-cc3a5a9a6b4c',
    '3adcdd9a-be61-4a6f-a309-6eca072fa90c',
    '3d0ebd11-8e33-4e62-af51-1ffa3aefc2ca',
    '42a03578-2af8-44ad-aa6a-85a57438d06c',
    '49698fc6-6c43-4ad3-b32a-9f471d8dae1d',
    '4b24589c-cd75-4641-bb09-fb4122a4e931',
    '4bc99054-c14a-41bd-bf1a-fe1abdd19d34',
    '57e58a7f-ff80-4b2b-b629-b5f8977aed6a',
    '58d7a149-cf18-4959-a28e-f37879a6079c',
    '5c5dcb3e-446e-46b8-9276-19b9c9eb930b',
    '5d2cc805-5f8d-4b32-98db-4cc926cfc487',
    '5df99570-108c-4dc9-9469-fbf2a2591542',
    '5e98e671-908c-4829-b2d0-4e6865c4c3b7',
    '69de73b3-f11b-4dd4-8f87-3487f1dccf9b',
    '6a3d5f37-5224-493f-bc0e-c3b10ef09cfd',
    '6da3450b-636f-4f32-a8d8-feef075dcfc3',
    '7460ab92-59a9-498f-b5f8-25da0de77b16',
    '7689d9c7-7152-42d4-826e-be025ded14c6',
    '7de103ae-0b38-40d7-8bf1-558438255911',
    '88ff4e9e-817d-4e95-affe-88ea0d35bb74',
    '89c458ad-c1ed-4a57-ada8-6d37b3561087',
    '8c6fb649-a965-4074-81b2-dd79d0cf3085',
    '902fcc3f-f06c-44b4-ba1f-d063e6ad9efc',
    '93ea6988-0cf8-4164-9d61-3c19770a1163',
    '95fdc901-fd26-48e6-8ffa-3fa8e7f1ad72',
    '990b9db7-6251-4097-9465-03c4e0f8e0fd',
    '99fd127d-5125-4fd2-82ba-7dede7f829b1',
    '9aeef5d6-3b4a-4f0b-813b-4386695632d0',
    'a48a843a-c32c-4af5-b9f4-f7b43f1200e2',
    'a558fee5-e155-4b3e-9a9a-f5f733a44714',
    'aa930448-64db-4070-81d4-f255e5e46b35',
    'aaa82124-57ae-4686-9c88-d52ab4bca06e',
    'ab560222-3adc-41a1-ad87-bac969068f3e',
    'acb32492-38f5-4afe-9658-8894dfabc601',
    'af8ed5f0-aa8e-42b2-9102-59ef3c91b5ae',
    'af9d8e48-263a-4eda-b4b3-e0c59ab553a2',
    'b576ff5a-074a-4854-ae88-e110709bf401',
    'b64e3cdd-6e00-4d45-88d6-7e8afdaff0fb',
    'bb10498e-2de0-4158-8e96-a2e866f1214a',
    'bcfa87e4-2521-492d-b025-2af643e07d42',
    'bf3112e0-da9a-4c0f-bf7e-a02c6c1c0c21',
    'c25287b4-5b0a-4681-ab77-15909687f5b6',
    'c254115d-ed85-4630-ba03-a8b79c6d6be6',
    'c3e30705-d015-4005-b00c-05fbbba1f091',
    'c3eb84b6-c023-488e-93be-5086610d1b4f',
    'ca23c8f8-179a-49ba-a3a4-0921ef91e7bc',
    'd3abdd68-1fc0-4248-8537-bee9bf06f52c',
    'd7246747-2340-4f3d-85ac-3a72f83bff09',
    'd99e0109-5127-426b-ad76-bf7a07fc11de',
    'da1b759e-f8f9-4ca2-8c5c-1286a80a5505',
    'dbb79f76-5d37-4588-9f49-c45f51e2cf50',
    'df2b7212-c768-4d61-b1df-a3a9bcfbad2a',
    'dffaed74-aaae-400c-b1fe-16622a52ab61',
    'ea79a68d-8c51-43b1-9bf5-f8c2a1a21c70',
    'ebb3b221-7001-485b-aa04-3630926d86cf',
    'f2d95405-7884-4353-aa65-ced94ba18793',
    'f91d5151-9786-4daf-af96-6b07dae3c7a2'
  );

-- ── 2. sales_item_facts: insert corrected rows ───────────────────────────────────────────────
INSERT INTO clickhouse_analytics.sales_item_facts
SELECT
    tenant_id,
    branch_id,
    toDate('2026-08-06') AS business_date,   -- the ONLY changed column
    order_id,
    line_no,
    menu_item_id,
    item_name,
    qty,
    unit_price_paisa,
    line_total_paisa,
    cogs_paisa,
    gross_margin_paisa,
    category_name,
    closed_at,
    event_id
FROM clickhouse_analytics.sales_item_facts
WHERE business_date = toDate('2026-08-07')
  AND order_id IN (
    '04324d1f-761a-44ad-9d41-620c39725ae8',
    '06ace961-23ea-4aae-bcce-6832f793f4e4',
    '0bf1b8ea-d276-48bc-a71b-80dbad71ac26',
    '1086ab5f-1711-478b-bd6d-16e5145958df',
    '138a2eca-fc6c-4412-88b7-283ef3bface3',
    '17b877c6-5061-4143-adf5-e8ed447ae217',
    '18ac9b46-97b8-4a9e-a945-7e5776235c3c',
    '1b459076-c0d4-42e5-8b17-287cdc235413',
    '21301a15-eb1f-4954-8598-a16788331f53',
    '213a0296-7a83-4bc3-b480-f724a154ec9a',
    '23182fc4-81dc-4440-9316-841daa104b88',
    '240d6bfd-7ca9-48ac-98a3-a32f928ccf31',
    '26b0c03d-e616-41b4-bb36-229ebae4b5a2',
    '2d22f2d7-6141-43f6-b37a-acf17f040616',
    '309ff29a-cb10-45f4-b1c7-9e28c6edd9ab',
    '31a52625-a22a-47c5-bc3e-04887a8f64df',
    '336c318e-f8d1-45de-9970-cc3a5a9a6b4c',
    '3adcdd9a-be61-4a6f-a309-6eca072fa90c',
    '3d0ebd11-8e33-4e62-af51-1ffa3aefc2ca',
    '42a03578-2af8-44ad-aa6a-85a57438d06c',
    '49698fc6-6c43-4ad3-b32a-9f471d8dae1d',
    '4b24589c-cd75-4641-bb09-fb4122a4e931',
    '4bc99054-c14a-41bd-bf1a-fe1abdd19d34',
    '57e58a7f-ff80-4b2b-b629-b5f8977aed6a',
    '58d7a149-cf18-4959-a28e-f37879a6079c',
    '5c5dcb3e-446e-46b8-9276-19b9c9eb930b',
    '5d2cc805-5f8d-4b32-98db-4cc926cfc487',
    '5df99570-108c-4dc9-9469-fbf2a2591542',
    '5e98e671-908c-4829-b2d0-4e6865c4c3b7',
    '69de73b3-f11b-4dd4-8f87-3487f1dccf9b',
    '6a3d5f37-5224-493f-bc0e-c3b10ef09cfd',
    '6da3450b-636f-4f32-a8d8-feef075dcfc3',
    '7460ab92-59a9-498f-b5f8-25da0de77b16',
    '7689d9c7-7152-42d4-826e-be025ded14c6',
    '7de103ae-0b38-40d7-8bf1-558438255911',
    '88ff4e9e-817d-4e95-affe-88ea0d35bb74',
    '89c458ad-c1ed-4a57-ada8-6d37b3561087',
    '8c6fb649-a965-4074-81b2-dd79d0cf3085',
    '902fcc3f-f06c-44b4-ba1f-d063e6ad9efc',
    '93ea6988-0cf8-4164-9d61-3c19770a1163',
    '95fdc901-fd26-48e6-8ffa-3fa8e7f1ad72',
    '990b9db7-6251-4097-9465-03c4e0f8e0fd',
    '99fd127d-5125-4fd2-82ba-7dede7f829b1',
    '9aeef5d6-3b4a-4f0b-813b-4386695632d0',
    'a48a843a-c32c-4af5-b9f4-f7b43f1200e2',
    'a558fee5-e155-4b3e-9a9a-f5f733a44714',
    'aa930448-64db-4070-81d4-f255e5e46b35',
    'aaa82124-57ae-4686-9c88-d52ab4bca06e',
    'ab560222-3adc-41a1-ad87-bac969068f3e',
    'acb32492-38f5-4afe-9658-8894dfabc601',
    'af8ed5f0-aa8e-42b2-9102-59ef3c91b5ae',
    'af9d8e48-263a-4eda-b4b3-e0c59ab553a2',
    'b576ff5a-074a-4854-ae88-e110709bf401',
    'b64e3cdd-6e00-4d45-88d6-7e8afdaff0fb',
    'bb10498e-2de0-4158-8e96-a2e866f1214a',
    'bcfa87e4-2521-492d-b025-2af643e07d42',
    'bf3112e0-da9a-4c0f-bf7e-a02c6c1c0c21',
    'c25287b4-5b0a-4681-ab77-15909687f5b6',
    'c254115d-ed85-4630-ba03-a8b79c6d6be6',
    'c3e30705-d015-4005-b00c-05fbbba1f091',
    'c3eb84b6-c023-488e-93be-5086610d1b4f',
    'ca23c8f8-179a-49ba-a3a4-0921ef91e7bc',
    'd3abdd68-1fc0-4248-8537-bee9bf06f52c',
    'd7246747-2340-4f3d-85ac-3a72f83bff09',
    'd99e0109-5127-426b-ad76-bf7a07fc11de',
    'da1b759e-f8f9-4ca2-8c5c-1286a80a5505',
    'dbb79f76-5d37-4588-9f49-c45f51e2cf50',
    'df2b7212-c768-4d61-b1df-a3a9bcfbad2a',
    'dffaed74-aaae-400c-b1fe-16622a52ab61',
    'ea79a68d-8c51-43b1-9bf5-f8c2a1a21c70',
    'ebb3b221-7001-485b-aa04-3630926d86cf',
    'f2d95405-7884-4353-aa65-ced94ba18793',
    'f91d5151-9786-4daf-af96-6b07dae3c7a2'
  );

-- ── 3. delete the superseded rows ────────────────────────────────────────────────────────────
-- Scoped by business_date AND order_id, so the corrected rows inserted above (which now carry
-- 2026-08-06) are not matched.
ALTER TABLE clickhouse_analytics.sales_order_facts
DELETE WHERE business_date = toDate('2026-08-07')
  AND order_id IN (
    '04324d1f-761a-44ad-9d41-620c39725ae8',
    '06ace961-23ea-4aae-bcce-6832f793f4e4',
    '0bf1b8ea-d276-48bc-a71b-80dbad71ac26',
    '1086ab5f-1711-478b-bd6d-16e5145958df',
    '138a2eca-fc6c-4412-88b7-283ef3bface3',
    '17b877c6-5061-4143-adf5-e8ed447ae217',
    '18ac9b46-97b8-4a9e-a945-7e5776235c3c',
    '1b459076-c0d4-42e5-8b17-287cdc235413',
    '21301a15-eb1f-4954-8598-a16788331f53',
    '213a0296-7a83-4bc3-b480-f724a154ec9a',
    '23182fc4-81dc-4440-9316-841daa104b88',
    '240d6bfd-7ca9-48ac-98a3-a32f928ccf31',
    '26b0c03d-e616-41b4-bb36-229ebae4b5a2',
    '2d22f2d7-6141-43f6-b37a-acf17f040616',
    '309ff29a-cb10-45f4-b1c7-9e28c6edd9ab',
    '31a52625-a22a-47c5-bc3e-04887a8f64df',
    '336c318e-f8d1-45de-9970-cc3a5a9a6b4c',
    '3adcdd9a-be61-4a6f-a309-6eca072fa90c',
    '3d0ebd11-8e33-4e62-af51-1ffa3aefc2ca',
    '42a03578-2af8-44ad-aa6a-85a57438d06c',
    '49698fc6-6c43-4ad3-b32a-9f471d8dae1d',
    '4b24589c-cd75-4641-bb09-fb4122a4e931',
    '4bc99054-c14a-41bd-bf1a-fe1abdd19d34',
    '57e58a7f-ff80-4b2b-b629-b5f8977aed6a',
    '58d7a149-cf18-4959-a28e-f37879a6079c',
    '5c5dcb3e-446e-46b8-9276-19b9c9eb930b',
    '5d2cc805-5f8d-4b32-98db-4cc926cfc487',
    '5df99570-108c-4dc9-9469-fbf2a2591542',
    '5e98e671-908c-4829-b2d0-4e6865c4c3b7',
    '69de73b3-f11b-4dd4-8f87-3487f1dccf9b',
    '6a3d5f37-5224-493f-bc0e-c3b10ef09cfd',
    '6da3450b-636f-4f32-a8d8-feef075dcfc3',
    '7460ab92-59a9-498f-b5f8-25da0de77b16',
    '7689d9c7-7152-42d4-826e-be025ded14c6',
    '7de103ae-0b38-40d7-8bf1-558438255911',
    '88ff4e9e-817d-4e95-affe-88ea0d35bb74',
    '89c458ad-c1ed-4a57-ada8-6d37b3561087',
    '8c6fb649-a965-4074-81b2-dd79d0cf3085',
    '902fcc3f-f06c-44b4-ba1f-d063e6ad9efc',
    '93ea6988-0cf8-4164-9d61-3c19770a1163',
    '95fdc901-fd26-48e6-8ffa-3fa8e7f1ad72',
    '990b9db7-6251-4097-9465-03c4e0f8e0fd',
    '99fd127d-5125-4fd2-82ba-7dede7f829b1',
    '9aeef5d6-3b4a-4f0b-813b-4386695632d0',
    'a48a843a-c32c-4af5-b9f4-f7b43f1200e2',
    'a558fee5-e155-4b3e-9a9a-f5f733a44714',
    'aa930448-64db-4070-81d4-f255e5e46b35',
    'aaa82124-57ae-4686-9c88-d52ab4bca06e',
    'ab560222-3adc-41a1-ad87-bac969068f3e',
    'acb32492-38f5-4afe-9658-8894dfabc601',
    'af8ed5f0-aa8e-42b2-9102-59ef3c91b5ae',
    'af9d8e48-263a-4eda-b4b3-e0c59ab553a2',
    'b576ff5a-074a-4854-ae88-e110709bf401',
    'b64e3cdd-6e00-4d45-88d6-7e8afdaff0fb',
    'bb10498e-2de0-4158-8e96-a2e866f1214a',
    'bcfa87e4-2521-492d-b025-2af643e07d42',
    'bf3112e0-da9a-4c0f-bf7e-a02c6c1c0c21',
    'c25287b4-5b0a-4681-ab77-15909687f5b6',
    'c254115d-ed85-4630-ba03-a8b79c6d6be6',
    'c3e30705-d015-4005-b00c-05fbbba1f091',
    'c3eb84b6-c023-488e-93be-5086610d1b4f',
    'ca23c8f8-179a-49ba-a3a4-0921ef91e7bc',
    'd3abdd68-1fc0-4248-8537-bee9bf06f52c',
    'd7246747-2340-4f3d-85ac-3a72f83bff09',
    'd99e0109-5127-426b-ad76-bf7a07fc11de',
    'da1b759e-f8f9-4ca2-8c5c-1286a80a5505',
    'dbb79f76-5d37-4588-9f49-c45f51e2cf50',
    'df2b7212-c768-4d61-b1df-a3a9bcfbad2a',
    'dffaed74-aaae-400c-b1fe-16622a52ab61',
    'ea79a68d-8c51-43b1-9bf5-f8c2a1a21c70',
    'ebb3b221-7001-485b-aa04-3630926d86cf',
    'f2d95405-7884-4353-aa65-ced94ba18793',
    'f91d5151-9786-4daf-af96-6b07dae3c7a2'
  );

ALTER TABLE clickhouse_analytics.sales_item_facts
DELETE WHERE business_date = toDate('2026-08-07')
  AND order_id IN (
    '04324d1f-761a-44ad-9d41-620c39725ae8',
    '06ace961-23ea-4aae-bcce-6832f793f4e4',
    '0bf1b8ea-d276-48bc-a71b-80dbad71ac26',
    '1086ab5f-1711-478b-bd6d-16e5145958df',
    '138a2eca-fc6c-4412-88b7-283ef3bface3',
    '17b877c6-5061-4143-adf5-e8ed447ae217',
    '18ac9b46-97b8-4a9e-a945-7e5776235c3c',
    '1b459076-c0d4-42e5-8b17-287cdc235413',
    '21301a15-eb1f-4954-8598-a16788331f53',
    '213a0296-7a83-4bc3-b480-f724a154ec9a',
    '23182fc4-81dc-4440-9316-841daa104b88',
    '240d6bfd-7ca9-48ac-98a3-a32f928ccf31',
    '26b0c03d-e616-41b4-bb36-229ebae4b5a2',
    '2d22f2d7-6141-43f6-b37a-acf17f040616',
    '309ff29a-cb10-45f4-b1c7-9e28c6edd9ab',
    '31a52625-a22a-47c5-bc3e-04887a8f64df',
    '336c318e-f8d1-45de-9970-cc3a5a9a6b4c',
    '3adcdd9a-be61-4a6f-a309-6eca072fa90c',
    '3d0ebd11-8e33-4e62-af51-1ffa3aefc2ca',
    '42a03578-2af8-44ad-aa6a-85a57438d06c',
    '49698fc6-6c43-4ad3-b32a-9f471d8dae1d',
    '4b24589c-cd75-4641-bb09-fb4122a4e931',
    '4bc99054-c14a-41bd-bf1a-fe1abdd19d34',
    '57e58a7f-ff80-4b2b-b629-b5f8977aed6a',
    '58d7a149-cf18-4959-a28e-f37879a6079c',
    '5c5dcb3e-446e-46b8-9276-19b9c9eb930b',
    '5d2cc805-5f8d-4b32-98db-4cc926cfc487',
    '5df99570-108c-4dc9-9469-fbf2a2591542',
    '5e98e671-908c-4829-b2d0-4e6865c4c3b7',
    '69de73b3-f11b-4dd4-8f87-3487f1dccf9b',
    '6a3d5f37-5224-493f-bc0e-c3b10ef09cfd',
    '6da3450b-636f-4f32-a8d8-feef075dcfc3',
    '7460ab92-59a9-498f-b5f8-25da0de77b16',
    '7689d9c7-7152-42d4-826e-be025ded14c6',
    '7de103ae-0b38-40d7-8bf1-558438255911',
    '88ff4e9e-817d-4e95-affe-88ea0d35bb74',
    '89c458ad-c1ed-4a57-ada8-6d37b3561087',
    '8c6fb649-a965-4074-81b2-dd79d0cf3085',
    '902fcc3f-f06c-44b4-ba1f-d063e6ad9efc',
    '93ea6988-0cf8-4164-9d61-3c19770a1163',
    '95fdc901-fd26-48e6-8ffa-3fa8e7f1ad72',
    '990b9db7-6251-4097-9465-03c4e0f8e0fd',
    '99fd127d-5125-4fd2-82ba-7dede7f829b1',
    '9aeef5d6-3b4a-4f0b-813b-4386695632d0',
    'a48a843a-c32c-4af5-b9f4-f7b43f1200e2',
    'a558fee5-e155-4b3e-9a9a-f5f733a44714',
    'aa930448-64db-4070-81d4-f255e5e46b35',
    'aaa82124-57ae-4686-9c88-d52ab4bca06e',
    'ab560222-3adc-41a1-ad87-bac969068f3e',
    'acb32492-38f5-4afe-9658-8894dfabc601',
    'af8ed5f0-aa8e-42b2-9102-59ef3c91b5ae',
    'af9d8e48-263a-4eda-b4b3-e0c59ab553a2',
    'b576ff5a-074a-4854-ae88-e110709bf401',
    'b64e3cdd-6e00-4d45-88d6-7e8afdaff0fb',
    'bb10498e-2de0-4158-8e96-a2e866f1214a',
    'bcfa87e4-2521-492d-b025-2af643e07d42',
    'bf3112e0-da9a-4c0f-bf7e-a02c6c1c0c21',
    'c25287b4-5b0a-4681-ab77-15909687f5b6',
    'c254115d-ed85-4630-ba03-a8b79c6d6be6',
    'c3e30705-d015-4005-b00c-05fbbba1f091',
    'c3eb84b6-c023-488e-93be-5086610d1b4f',
    'ca23c8f8-179a-49ba-a3a4-0921ef91e7bc',
    'd3abdd68-1fc0-4248-8537-bee9bf06f52c',
    'd7246747-2340-4f3d-85ac-3a72f83bff09',
    'd99e0109-5127-426b-ad76-bf7a07fc11de',
    'da1b759e-f8f9-4ca2-8c5c-1286a80a5505',
    'dbb79f76-5d37-4588-9f49-c45f51e2cf50',
    'df2b7212-c768-4d61-b1df-a3a9bcfbad2a',
    'dffaed74-aaae-400c-b1fe-16622a52ab61',
    'ea79a68d-8c51-43b1-9bf5-f8c2a1a21c70',
    'ebb3b221-7001-485b-aa04-3630926d86cf',
    'f2d95405-7884-4353-aa65-ced94ba18793',
    'f91d5151-9786-4daf-af96-6b07dae3c7a2'
  );
