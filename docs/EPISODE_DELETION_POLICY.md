# Episode Deletion Policy

ABStrack supports deliberate episode removal while preserving clear data-impact messaging.

## Policy

- Patients (and linked caretakers under RLS) can permanently remove **active or completed** episodes.
- There is currently no automated retention window; episodes persist until a user deletes them.

## Data Impact When Deleting Any Episode

Deleting an active episode applies these foreign-key rules:

- `episode_symptoms`: deleted (`ON DELETE CASCADE`)
- `health_markers`: deleted (`ON DELETE CASCADE`)
- `episode_media` metadata rows: deleted (`ON DELETE CASCADE`)
- `food_diary_entries`: kept, but `episode_id` is set to `NULL` (`ON DELETE SET NULL`)

This behavior prevents orphaned rows while preserving standalone food entries.

## RLS and Authorization

Deletion uses standard `episodes` delete RLS (`user_id = auth.uid()` or linked caretaker access). Practitioners do not have delete access.
