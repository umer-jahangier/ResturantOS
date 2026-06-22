-- ClickHouse init: create the analytics database.
-- This file must exist for the container volume mount to succeed.
-- The full schema (sales_facts, etc.) is added by the reporting-service migrations.
CREATE DATABASE IF NOT EXISTS clickhouse_analytics;
