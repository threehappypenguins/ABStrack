/**
 * Pure model of PHI replication scope for PowerSync buckets in `packages/powersync/sync-rules.yaml`.
 * PHI rows replicate when their `user_id` matches a scoped patient id from this model — the
 * authenticated user's id (`userId`, same intent as `auth.user_id()` / JWT `sub`) or a linked
 * `patient_user_id` from grant rows; profiles and grant tables use separate buckets in YAML.
 */

/** Mirrors `public.profiles.app_role` check constraint. */
export type AppRole = 'patient' | 'caretaker' | 'practitioner';

export interface CaretakerGrantRow {
  readonly patient_user_id: string;
  readonly caretaker_user_id: string;
  readonly revoked_at: string | null;
}

export interface PractitionerGrantRow {
  readonly patient_user_id: string;
  readonly practitioner_user_id: string;
  readonly revoked_at: string | null;
}

export interface SyncScopeModelInput {
  /** Authenticated user id — same intent as PowerSync Sync Streams `auth.user_id()` and JWT `sub`. */
  readonly userId: string;
  readonly appRole: AppRole;
  /** JWT `aal` claim; practitioner PHI requires `aal2` per RLS `user_has_practitioner_access`. */
  readonly jwtAal: string | null | undefined;
  readonly caretakerGrants: readonly CaretakerGrantRow[];
  readonly practitionerGrants: readonly PractitionerGrantRow[];
}

function activeCaretakerPatients(input: SyncScopeModelInput): Set<string> {
  const out = new Set<string>();
  if (input.appRole !== 'caretaker') return out;
  for (const g of input.caretakerGrants) {
    if (g.caretaker_user_id === input.userId && g.revoked_at == null) {
      out.add(g.patient_user_id);
    }
  }
  return out;
}

function activePractitionerPatients(input: SyncScopeModelInput): Set<string> {
  const out = new Set<string>();
  if (input.appRole !== 'practitioner') return out;
  if (input.jwtAal !== 'aal2') return out;
  for (const g of input.practitionerGrants) {
    if (g.practitioner_user_id === input.userId && g.revoked_at == null) {
      out.add(g.patient_user_id);
    }
  }
  return out;
}

/**
 * Returns distinct patient scope ids for `phi_*` buckets (aligned with YAML parameter queries:
 * `patient_self`, `caretaker_patients`, `practitioner_mfa_patients`). Values match PHI row `user_id`
 * (and `practitioner_observation_notes.patient_user_id`), profile ids, and grant-side
 * `patient_user_id`; combines own patient data, caretaker-linked patients, or practitioner-linked
 * patients with MFA (`aal2`).
 *
 * @param input Modeled auth claims and grant rows (same intent as sync-rule parameter queries).
 * @returns Stable sorted ids for assertions.
 */
export function visiblePatientUserIdsForPhiSync(
  input: SyncScopeModelInput,
): string[] {
  const out = new Set<string>();
  if (input.appRole === 'patient') {
    out.add(input.userId);
  }
  activeCaretakerPatients(input).forEach((id) => out.add(id));
  activePractitionerPatients(input).forEach((id) => out.add(id));
  return [...out].sort();
}
