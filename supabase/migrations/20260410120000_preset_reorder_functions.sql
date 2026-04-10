-- Atomic reorder for preset line tables (UNIQUE (preset_id, sort_order)).
-- Two-phase updates run in one transaction inside each function.

CREATE OR REPLACE FUNCTION public.reorder_preset_symptoms (
  p_preset_id uuid,
  p_ordered_ids uuid[]
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  n int;
  actual int;
BEGIN
  n := coalesce(cardinality(p_ordered_ids), 0);

  SELECT COUNT(*)::int INTO actual
  FROM public.preset_symptoms
  WHERE preset_id = p_preset_id;

  IF n <> actual THEN
    RAISE EXCEPTION 'abstrack_preset_reorder_count_mismatch'
      USING ERRCODE = 'P0001';
  END IF;

  IF n > 0 AND (
    SELECT COUNT(*) FROM unnest(p_ordered_ids) AS u(id)
  ) <> (
    SELECT COUNT(DISTINCT id) FROM unnest(p_ordered_ids) AS u(id)
  ) THEN
    RAISE EXCEPTION 'abstrack_preset_reorder_duplicate_id'
      USING ERRCODE = 'P0001';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM unnest(p_ordered_ids) AS t(id)
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.preset_symptoms ps
      WHERE ps.id = t.id AND ps.preset_id = p_preset_id
    )
  ) THEN
    RAISE EXCEPTION 'abstrack_preset_reorder_unknown_line'
      USING ERRCODE = 'P0001';
  END IF;

  IF n = 0 THEN
    RETURN;
  END IF;

  -- Phase 1: move all lines to a non-colliding sort_order band (one statement).
  UPDATE public.preset_symptoms ps
  SET sort_order = 1000000 + ord.pos - 1
  FROM (
    SELECT u.id, u.ordinality::int AS pos
    FROM unnest(p_ordered_ids) WITH ORDINALITY AS u(id, ordinality)
  ) ord
  WHERE ps.id = ord.id
    AND ps.preset_id = p_preset_id;

  -- Phase 2: assign final 0..n-1 order (one statement).
  UPDATE public.preset_symptoms ps
  SET sort_order = ord.pos - 1
  FROM (
    SELECT u.id, u.ordinality::int AS pos
    FROM unnest(p_ordered_ids) WITH ORDINALITY AS u(id, ordinality)
  ) ord
  WHERE ps.id = ord.id
    AND ps.preset_id = p_preset_id;
END;
$$;

COMMENT ON FUNCTION public.reorder_preset_symptoms (uuid, uuid[]) IS
'Reassigns sort_order for every preset_symptoms row for p_preset_id; p_ordered_ids lists each line id exactly once in display order.';

CREATE OR REPLACE FUNCTION public.reorder_preset_health_markers (
  p_preset_id uuid,
  p_ordered_ids uuid[]
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  n int;
  actual int;
BEGIN
  n := coalesce(cardinality(p_ordered_ids), 0);

  SELECT COUNT(*)::int INTO actual
  FROM public.preset_health_markers
  WHERE preset_id = p_preset_id;

  IF n <> actual THEN
    RAISE EXCEPTION 'abstrack_preset_reorder_count_mismatch'
      USING ERRCODE = 'P0001';
  END IF;

  IF n > 0 AND (
    SELECT COUNT(*) FROM unnest(p_ordered_ids) AS u(id)
  ) <> (
    SELECT COUNT(DISTINCT id) FROM unnest(p_ordered_ids) AS u(id)
  ) THEN
    RAISE EXCEPTION 'abstrack_preset_reorder_duplicate_id'
      USING ERRCODE = 'P0001';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM unnest(p_ordered_ids) AS t(id)
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.preset_health_markers ph
      WHERE ph.id = t.id AND ph.preset_id = p_preset_id
    )
  ) THEN
    RAISE EXCEPTION 'abstrack_preset_reorder_unknown_line'
      USING ERRCODE = 'P0001';
  END IF;

  IF n = 0 THEN
    RETURN;
  END IF;

  UPDATE public.preset_health_markers ph
  SET sort_order = 1000000 + ord.pos - 1
  FROM (
    SELECT u.id, u.ordinality::int AS pos
    FROM unnest(p_ordered_ids) WITH ORDINALITY AS u(id, ordinality)
  ) ord
  WHERE ph.id = ord.id
    AND ph.preset_id = p_preset_id;

  UPDATE public.preset_health_markers ph
  SET sort_order = ord.pos - 1
  FROM (
    SELECT u.id, u.ordinality::int AS pos
    FROM unnest(p_ordered_ids) WITH ORDINALITY AS u(id, ordinality)
  ) ord
  WHERE ph.id = ord.id
    AND ph.preset_id = p_preset_id;
END;
$$;

COMMENT ON FUNCTION public.reorder_preset_health_markers (uuid, uuid[]) IS
'Reassigns sort_order for every preset_health_markers row for p_preset_id; p_ordered_ids lists each line id exactly once in display order.';

REVOKE ALL ON FUNCTION public.reorder_preset_symptoms (uuid, uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reorder_preset_symptoms (uuid, uuid[]) TO authenticated;

REVOKE ALL ON FUNCTION public.reorder_preset_health_markers (uuid, uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reorder_preset_health_markers (uuid, uuid[]) TO authenticated;
