-- Provision public.profiles when Supabase Auth creates auth.users (official pattern:
-- https://supabase.com/docs/guides/auth/managing-user-data#using-triggers).
--
-- Edge Functions stamp `app_role` in user metadata at invite time; self-signup defaults to patient.
-- Practitioner rows require profiles_enforce_app_role bypass via transaction-local flag (only set here).

CREATE OR REPLACE FUNCTION public.profiles_enforce_app_role ()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, public, pg_temp
  AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.app_role = 'practitioner'
      AND NOT public.profiles_trusted_session_for_app_role ()
      AND current_setting('abstrack.provisioning_profile_from_auth', TRUE) IS DISTINCT FROM 'true' THEN
      RAISE EXCEPTION 'profiles.app_role practitioner requires a trusted path';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF OLD.app_role IS DISTINCT FROM NEW.app_role
      AND NOT public.profiles_trusted_session_for_app_role () THEN
      RAISE EXCEPTION 'profiles.app_role cannot be changed without a trusted path';
    END IF;
    RETURN NEW;
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.profiles_enforce_app_role () IS 'Blocks practitioner self-signup and arbitrary app_role changes unless session is trusted (service_role / postgres). On INSERT, also allows practitioner when transaction-local abstrack.provisioning_profile_from_auth is true (set only by public.handle_new_user during auth.users provisioning).';

CREATE OR REPLACE FUNCTION public.handle_new_user ()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = ''
  AS $$
DECLARE
  v_role text;
BEGIN
  v_role := COALESCE(new.raw_user_meta_data ->> 'app_role', 'patient');
  IF v_role NOT IN ('patient', 'caretaker', 'practitioner') THEN
    v_role := 'patient';
  END IF;

  -- Require invite stamps for non-patient roles (blocks self-signup metadata spoofing).
  IF v_role = 'practitioner'
    AND nullif(trim(new.raw_user_meta_data ->> 'abstrack_practitioner_invite_id'), '') IS NULL THEN
    v_role := 'patient';
  ELSIF v_role = 'caretaker'
    AND nullif(trim(new.raw_user_meta_data ->> 'abstrack_caretaker_invite_id'), '') IS NULL THEN
    v_role := 'patient';
  END IF;

  IF v_role = 'practitioner' THEN
    PERFORM set_config('abstrack.provisioning_profile_from_auth', 'true', TRUE);
  END IF;

  INSERT INTO public.profiles (id, app_role)
    VALUES (new.id, v_role)
  ON CONFLICT (id)
    DO NOTHING;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.handle_new_user () IS 'After insert on auth.users: creates profiles from invite-stamped app_role metadata (Edge Functions) or patient for self-signup.';

REVOKE ALL ON FUNCTION public.handle_new_user ()
FROM PUBLIC;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user ();

-- Backfill profiles for auth users created before this migration.
INSERT INTO public.profiles (id, app_role)
SELECT
  u.id,
  CASE
  WHEN COALESCE(u.raw_user_meta_data ->> 'app_role', 'patient') = 'practitioner'
    AND nullif(trim(u.raw_user_meta_data ->> 'abstrack_practitioner_invite_id'), '') IS NOT NULL THEN
    'practitioner'
  WHEN COALESCE(u.raw_user_meta_data ->> 'app_role', 'patient') = 'caretaker'
    AND nullif(trim(u.raw_user_meta_data ->> 'abstrack_caretaker_invite_id'), '') IS NOT NULL THEN
    'caretaker'
  ELSE
    'patient'
  END
FROM
  auth.users AS u
WHERE
  NOT EXISTS (
    SELECT
      1
    FROM
      public.profiles AS p
    WHERE
      p.id = u.id);
