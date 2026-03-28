-- ABStrack — core schema (Week 2)
--
-- PHI model: Postgres stores health fields as normal columns (plaintext at the application
-- layer). Protection is RLS (enforced in later migrations), TLS, and platform / managed
-- encryption at rest — not application-layer ciphertext columns or per-user DEKs shared
-- across patient, caretaker, and practitioner. See docs/PRD.md (“Data model: plaintext PHI
-- in Supabase under RLS”, “Authorized access: practitioners and caretakers (no DEK sharing)”).
--
-- Append-only audit semantics for public.access_log (privileges / triggers / RLS) are defined
-- in issue #8; this migration only creates the table shape (no PHI columns in log rows).

-- ---------------------------------------------------------------------------
-- profiles — app metadata keyed to Supabase Auth
-- ---------------------------------------------------------------------------
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  display_name text,
  app_role text NOT NULL
    CHECK (app_role IN ('patient', 'caretaker', 'practitioner')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX profiles_app_role_idx ON public.profiles (app_role);

COMMENT ON TABLE public.profiles IS 'App profile keyed to auth.users; display_name may be identifying. Role used for routing; RLS in later migrations.';

-- ---------------------------------------------------------------------------
-- symptom_presets — named symptom preset (header row); lines live in preset_symptoms
-- ---------------------------------------------------------------------------
CREATE TABLE public.symptom_presets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now (),
  updated_at timestamptz NOT NULL DEFAULT now (),
  CONSTRAINT symptom_presets_user_id_id_key UNIQUE (user_id, id)
);

CREATE INDEX symptom_presets_user_idx ON public.symptom_presets (user_id);

COMMENT ON TABLE public.symptom_presets IS 'One named symptom preset per row (PRD §2); preset_symptoms.preset_id FKs here.';

-- ---------------------------------------------------------------------------
-- preset_symptoms — ordered symptom lines within a preset (rows, not columns)
-- ---------------------------------------------------------------------------
CREATE TABLE public.preset_symptoms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
  preset_id uuid NOT NULL REFERENCES public.symptom_presets (id) ON DELETE CASCADE,
  sort_order integer NOT NULL CHECK (sort_order >= 0),
  symptom_name text NOT NULL,
  response_type text NOT NULL
    CHECK (
      response_type IN (
        'yes_no',
        'severity_scale',
        'free_text',
        'photo',
        'video'
      )
    ),
  prompt_instruction text,
  created_at timestamptz NOT NULL DEFAULT now (),
  updated_at timestamptz NOT NULL DEFAULT now (),
  UNIQUE (preset_id, sort_order)
);

CREATE INDEX preset_symptoms_preset_idx ON public.preset_symptoms (preset_id);
CREATE INDEX preset_symptoms_preset_sort_idx ON public.preset_symptoms (preset_id, sort_order);

COMMENT ON COLUMN public.preset_symptoms.sort_order IS 'Explicit per-row order within a preset; UNIQUE (preset_id, sort_order).';
COMMENT ON COLUMN public.preset_symptoms.response_type IS 'Symptom capture UI: yes/no, 1–5 scale, text, or media per PRD §2.';

-- ---------------------------------------------------------------------------
-- health_marker_presets — named health-marker preset (header); lines live in preset_health_markers
-- ---------------------------------------------------------------------------
CREATE TABLE public.health_marker_presets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now (),
  updated_at timestamptz NOT NULL DEFAULT now (),
  CONSTRAINT health_marker_presets_user_id_id_key UNIQUE (user_id, id)
);

CREATE INDEX health_marker_presets_user_idx ON public.health_marker_presets (user_id);

COMMENT ON TABLE public.health_marker_presets IS 'One named health-marker preset per row (PRD §3); preset_health_markers.preset_id FKs here.';

-- ---------------------------------------------------------------------------
-- preset_health_markers — ordered health marker lines within a preset
-- ---------------------------------------------------------------------------
CREATE TABLE public.preset_health_markers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
  preset_id uuid NOT NULL REFERENCES public.health_marker_presets (id) ON DELETE CASCADE,
  sort_order integer NOT NULL CHECK (sort_order >= 0),
  marker_kind text NOT NULL
    CHECK (
      marker_kind IN (
        'bac',
        'blood_glucose',
        'blood_pressure',
        'heart_rate',
        'weight',
        'custom'
      )
    ),
  custom_name text,
  custom_unit text,
  created_at timestamptz NOT NULL DEFAULT now (),
  updated_at timestamptz NOT NULL DEFAULT now (),
  UNIQUE (preset_id, sort_order)
);

CREATE INDEX preset_health_markers_preset_idx ON public.preset_health_markers (preset_id);
CREATE INDEX preset_health_markers_preset_sort_idx ON public.preset_health_markers (preset_id, sort_order);

COMMENT ON COLUMN public.preset_health_markers.sort_order IS 'Explicit per-row order within a preset; UNIQUE (preset_id, sort_order).';

-- ---------------------------------------------------------------------------
-- episodes — discrete ABS / other flare events
-- ---------------------------------------------------------------------------
CREATE TABLE public.episodes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  symptom_preset_id uuid,
  episode_type text NOT NULL DEFAULT 'Other'
    CHECK (episode_type IN ('ABS', 'Other')),
  episode_label text,
  note text,
  started_at timestamptz NOT NULL,
  ended_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now (),
  updated_at timestamptz NOT NULL DEFAULT now (),
  CONSTRAINT episodes_symptom_preset_fk FOREIGN KEY (user_id, symptom_preset_id)
    REFERENCES public.symptom_presets (user_id, id)
    ON DELETE SET NULL,
  CONSTRAINT episodes_ended_after_started CHECK (
    ended_at IS NULL
    OR ended_at >= started_at
  )
);

CREATE INDEX episodes_user_started_idx ON public.episodes (user_id, started_at DESC);
CREATE INDEX episodes_user_type_idx ON public.episodes (user_id, episode_type);

COMMENT ON COLUMN public.episodes.symptom_preset_id IS 'Optional FK to symptom_presets.id; composite (user_id, symptom_preset_id) ensures the preset belongs to the episode owner.';
COMMENT ON COLUMN public.episodes.episode_type IS 'Filtering/metadata: ABS vs Other per PRD §4.';

-- ---------------------------------------------------------------------------
-- episode_symptoms — one row per logged symptom (nullable episode_id for ad-hoc logs)
-- ---------------------------------------------------------------------------
CREATE TABLE public.episode_symptoms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  episode_id uuid REFERENCES public.episodes (id) ON DELETE CASCADE,
  preset_symptom_id uuid REFERENCES public.preset_symptoms (id) ON DELETE SET NULL,
  symptom_name text NOT NULL,
  response_type text NOT NULL
    CHECK (
      response_type IN (
        'yes_no',
        'severity_scale',
        'free_text',
        'photo',
        'video'
      )
    ),
  response_boolean boolean,
  response_severity smallint CHECK (
    response_severity IS NULL
    OR (response_severity >= 1 AND response_severity <= 5)
  ),
  response_text text,
  sort_order integer NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
  created_at timestamptz NOT NULL DEFAULT now (),
  updated_at timestamptz NOT NULL DEFAULT now (),
  CONSTRAINT episode_symptoms_response_matches_type CHECK (
    (
      response_type = 'yes_no'
      AND response_severity IS NULL
      AND response_text IS NULL
    )
    OR (
      response_type = 'severity_scale'
      AND response_boolean IS NULL
      AND response_text IS NULL
    )
    OR (
      response_type = 'free_text'
      AND response_boolean IS NULL
      AND response_severity IS NULL
    )
    OR (
      response_type IN ('photo', 'video')
      AND response_boolean IS NULL
      AND response_severity IS NULL
    )
  )
);

CREATE INDEX episode_symptoms_episode_idx ON public.episode_symptoms (episode_id);
CREATE INDEX episode_symptoms_user_idx ON public.episode_symptoms (user_id);
CREATE INDEX episode_symptoms_episode_sort_idx ON public.episode_symptoms (episode_id, sort_order);

COMMENT ON TABLE public.episode_symptoms IS 'Symptom answers as rows; episode_id NULL allows ad-hoc symptom logs without a full episode (PRD §5).';
COMMENT ON COLUMN public.episode_symptoms.episode_id IS 'Null for standalone / wellness symptom entries; set when part of an episode flow.';

-- ---------------------------------------------------------------------------
-- health_markers — measurements (episode, wellness, or ad-hoc) as rows
-- ---------------------------------------------------------------------------
CREATE TABLE public.health_markers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  episode_id uuid REFERENCES public.episodes (id) ON DELETE CASCADE,
  marker_kind text NOT NULL
    CHECK (
      marker_kind IN (
        'bac',
        'blood_glucose',
        'blood_pressure',
        'heart_rate',
        'weight',
        'custom',
        'wellness_mood'
      )
    ),
  custom_name text,
  custom_unit text,
  value_numeric numeric,
  systolic_numeric numeric,
  diastolic_numeric numeric,
  recorded_at timestamptz NOT NULL,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now (),
  updated_at timestamptz NOT NULL DEFAULT now ()
);

CREATE INDEX health_markers_user_recorded_idx ON public.health_markers (user_id, recorded_at DESC);
CREATE INDEX health_markers_episode_idx ON public.health_markers (episode_id);

COMMENT ON TABLE public.health_markers IS 'Manual marker entries; episode_id NULL for wellness / non-episode capture (PRD §3, §5).';
COMMENT ON COLUMN public.health_markers.marker_kind IS 'Includes wellness_mood for “how are you feeling” style logs per PRD §5.';

-- ---------------------------------------------------------------------------
-- food_diary_entries — meal notes and tags (plaintext PHI columns)
-- ---------------------------------------------------------------------------
CREATE TABLE public.food_diary_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  episode_id uuid REFERENCES public.episodes (id) ON DELETE SET NULL,
  meal_tag text NOT NULL
    CHECK (
      meal_tag IN ('Breakfast', 'Lunch', 'Dinner', 'Snack', 'Other')
    ),
  food_note text NOT NULL,
  logged_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now (),
  updated_at timestamptz NOT NULL DEFAULT now ()
);

CREATE INDEX food_diary_user_logged_idx ON public.food_diary_entries (user_id, logged_at DESC);
CREATE INDEX food_diary_episode_idx ON public.food_diary_entries (episode_id);

COMMENT ON COLUMN public.food_diary_entries.food_note IS 'Free-text meal description; plaintext under RLS per PRD §6.';
COMMENT ON COLUMN public.food_diary_entries.meal_tag IS 'Filtering metadata: Breakfast / Lunch / Dinner / Snack / Other per PRD §6.';

-- ---------------------------------------------------------------------------
-- practitioner_access — patient-initiated grants (no shared DEK columns)
-- ---------------------------------------------------------------------------
CREATE TABLE public.practitioner_access (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
  patient_user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  practitioner_user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now (),
  revoked_at timestamptz,
  UNIQUE (patient_user_id, practitioner_user_id),
  CHECK (patient_user_id <> practitioner_user_id)
);

CREATE INDEX practitioner_access_patient_idx ON public.practitioner_access (patient_user_id);
CREATE INDEX practitioner_access_practitioner_idx ON public.practitioner_access (practitioner_user_id);
CREATE INDEX practitioner_access_active_idx ON public.practitioner_access (practitioner_user_id)
WHERE
  revoked_at IS NULL;

COMMENT ON TABLE public.practitioner_access IS 'Grant rows for practitioner read access; enforced by RLS in later migrations.';

-- ---------------------------------------------------------------------------
-- caretaker_access — patient-initiated caretaker links (MVP: one active caretaker)
-- ---------------------------------------------------------------------------
CREATE TABLE public.caretaker_access (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
  patient_user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  caretaker_user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now (),
  revoked_at timestamptz,
  UNIQUE (patient_user_id, caretaker_user_id),
  CHECK (patient_user_id <> caretaker_user_id)
);

CREATE INDEX caretaker_access_caretaker_idx ON public.caretaker_access (caretaker_user_id);

CREATE UNIQUE INDEX caretaker_access_one_active_per_patient_idx ON public.caretaker_access (patient_user_id)
WHERE
  revoked_at IS NULL;

COMMENT ON TABLE public.caretaker_access IS 'Caretaker grant; partial unique index enforces one active caretaker per patient for MVP (PRD §7).';

-- ---------------------------------------------------------------------------
-- episode_media — Storage object keys and linkage to episode / symptom step
-- ---------------------------------------------------------------------------
CREATE TABLE public.episode_media (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  episode_id uuid NOT NULL REFERENCES public.episodes (id) ON DELETE CASCADE,
  episode_symptom_id uuid REFERENCES public.episode_symptoms (id) ON DELETE SET NULL,
  storage_object_key text NOT NULL,
  thumbnail_storage_key text,
  media_type text NOT NULL CHECK (media_type IN ('photo', 'video')),
  duration_seconds smallint CHECK (
    duration_seconds IS NULL
    OR (duration_seconds >= 1 AND duration_seconds <= 15)
  ),
  upload_completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now (),
  updated_at timestamptz NOT NULL DEFAULT now ()
);

CREATE INDEX episode_media_episode_idx ON public.episode_media (episode_id);
CREATE INDEX episode_media_user_idx ON public.episode_media (user_id);
CREATE INDEX episode_media_symptom_step_idx ON public.episode_media (episode_symptom_id);

COMMENT ON TABLE public.episode_media IS 'Metadata for private bucket objects; confidentiality via Storage RLS + TLS + platform encryption (PRD §10), not ciphertext columns here.';
COMMENT ON COLUMN public.episode_media.storage_object_key IS 'Path/key within the episode-media bucket; no encryption_iv or ciphertext columns in Postgres per PRD.';

-- ---------------------------------------------------------------------------
-- access_log — append-only audit metadata (no PHI in rows)
-- ---------------------------------------------------------------------------
CREATE TABLE public.access_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
  occurred_at timestamptz NOT NULL DEFAULT now (),
  actor_user_id uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  actor_role text NOT NULL
    CHECK (
      actor_role IN ('patient', 'caretaker', 'practitioner', 'system', 'service')
    ),
  patient_user_id uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  action text NOT NULL,
  resource_type text NOT NULL,
  resource_id uuid,
  request_id text,
  ip_hash text
);

CREATE INDEX access_log_patient_time_idx ON public.access_log (patient_user_id, occurred_at DESC);
CREATE INDEX access_log_actor_time_idx ON public.access_log (actor_user_id, occurred_at DESC);
CREATE INDEX access_log_resource_idx ON public.access_log (resource_type, resource_id);

COMMENT ON TABLE public.access_log IS 'Append-only audit trail; no PHI or clinical free text. Privileges and triggers in issue #8.';
COMMENT ON COLUMN public.access_log.action IS 'e.g. read, write, auth_failure per PRD § Access logging.';
COMMENT ON COLUMN public.access_log.resource_type IS 'e.g. episode, storage_object; resource_id is opaque UUID.';

-- ---------------------------------------------------------------------------
-- updated_at: bump on row UPDATE (DEFAULT only covers INSERT)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_updated_at ()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at ();

CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.symptom_presets
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at ();

CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.health_marker_presets
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at ();

CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.preset_symptoms
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at ();

CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.preset_health_markers
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at ();

CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.episodes
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at ();

CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.episode_symptoms
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at ();

CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.health_markers
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at ();

CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.food_diary_entries
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at ();

CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.episode_media
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at ();
