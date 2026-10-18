-- Runs once when the platform-db volume is first created (local dev only).
-- The app connects as this non-owner role so Row-Level Security always applies.
CREATE ROLE storeops_app LOGIN PASSWORD 'storeops_app';
