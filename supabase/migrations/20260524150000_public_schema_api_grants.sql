-- PostgREST / API roles need table and sequence privileges on objects created in migrations.
-- RLS alone is not sufficient: authenticated clients get 403 without GRANTs; service_role
-- (secret API key) gets 42501 without GRANTs even when RLS is bypassed (integration tests, Edge).

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;

GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon;

GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;

GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;

GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO anon;

GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT ON TABLES TO anon;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON TABLES TO service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO authenticated;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO anon;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON SEQUENCES TO service_role;
