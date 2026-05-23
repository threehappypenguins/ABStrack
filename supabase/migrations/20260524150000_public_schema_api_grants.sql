-- PostgREST roles need explicit table/sequence privileges on existing objects.
-- RLS enforces row access; missing GRANTs yield 403 (authenticated) or 42501 (service_role).
--
-- Fail-closed: no GRANT ALL, no ALTER DEFAULT PRIVILEGES (new tables stay closed until a
-- migration grants them). Re-applies minimal access_log / chart_snapshots privileges so
-- blanket grants from an earlier revision cannot widen them.

GRANT USAGE ON SCHEMA public TO authenticated, service_role;

-- Patient / caretaker / practitioner app data (RLS is authoritative).
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.profiles,
  public.symptom_presets,
  public.preset_symptoms,
  public.health_marker_presets,
  public.preset_health_markers,
  public.episode_templates,
  public.episodes,
  public.episode_symptoms,
  public.health_markers,
  public.food_diary_entries,
  public.episode_media,
  public.practitioner_access,
  public.caretaker_access,
  public.practitioner_observation_notes,
  public.practitioner_invites,
  public.caretaker_invites TO authenticated;

-- Sequences for serial/identity columns on the tables above (existing objects only).
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;

-- service_role: integration tests and Edge Functions (narrow table grants, not ALL).
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.profiles TO service_role;

GRANT SELECT ON TABLE public.symptom_presets,
  public.preset_symptoms,
  public.health_marker_presets,
  public.preset_health_markers,
  public.episode_templates,
  public.episodes,
  public.episode_symptoms,
  public.health_markers,
  public.food_diary_entries,
  public.episode_media,
  public.practitioner_observation_notes TO service_role;

GRANT SELECT, INSERT, UPDATE ON TABLE public.practitioner_access,
  public.caretaker_access TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.practitioner_invites,
  public.caretaker_invites TO service_role;

GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO service_role;

-- ---------------------------------------------------------------------------
-- Restricted tables (must match 20260327130000_rls_policies.sql and 20260524130000_chart_snapshots.sql)
-- ---------------------------------------------------------------------------
REVOKE ALL ON TABLE public.access_log
FROM PUBLIC, anon, authenticated, service_role;

GRANT SELECT ON TABLE public.access_log TO authenticated;

GRANT INSERT, SELECT ON TABLE public.access_log TO service_role;

REVOKE ALL ON TABLE public.chart_snapshots
FROM PUBLIC, anon, authenticated, service_role;

GRANT SELECT, INSERT ON TABLE public.chart_snapshots TO authenticated;

GRANT SELECT, INSERT ON TABLE public.chart_snapshots TO service_role;
