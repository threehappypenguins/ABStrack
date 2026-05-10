/**
 * End-to-end preset flows against **Supabase Cloud** (or any project reachable via env).
 * Uses the secret API key only to create/delete disposable test users; app calls use the
 * publishable key + user sessions so RLS applies.
 *
 * Skips when `SUPABASE_SECRET_KEY` or public Supabase URL/key env vars are missing (e.g. CI
 * without the optional secret, or local runs without env). See **docs/SUPABASE_CLOUD_DEVELOPER.md**.
 *
 * Auth users are created in `beforeAll` and removed in `afterAll`, so they usually do not stay
 * visible in **Authentication → Users**. Confirm behavior from the test output (pass vs skip) and
 * `console.info` lines, not the dashboard. Optional: `ABSTRACK_PRESET_INTEGRATION_LOG=1` logs why
 * the suite skipped when env is incomplete.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import type { Database } from './lib/database.types.js';
import { getSupabasePublishableKey, getSupabaseUrl } from './lib/env-public.js';
import type { AbstrackSupabaseClient } from './lib/supabase-client-type.js';
import { getSupabaseAdminClient } from './admin.js';
import {
  createEpisodeTemplate,
  deleteEpisodeTemplate,
  getEpisodeTemplateById,
  listEpisodeTemplates,
  updateEpisodeTemplate,
} from './lib/episode-template-data.js';
import {
  createHealthMarkerPreset,
  createPresetHealthMarker,
  createPresetSymptom,
  createSymptomPreset,
  deleteHealthMarkerPreset,
  deletePresetHealthMarker,
  deletePresetSymptom,
  deleteSymptomPreset,
  getHealthMarkerPresetById,
  getSymptomPresetById,
  listPresetHealthMarkersForPreset,
  listPresetSymptomsForPreset,
  listSymptomPresets,
  reorderPresetHealthMarkers,
  reorderPresetSymptoms,
  updateHealthMarkerPreset,
  updatePresetHealthMarker,
  updatePresetSymptom,
  updateSymptomPreset,
} from './lib/preset-data.js';

/**
 * True when the secret key is set and {@link getSupabaseUrl} / {@link getSupabasePublishableKey}
 * would succeed (same names as apps: `NEXT_PUBLIC_*`, `EXPO_PUBLIC_*`, or `SUPABASE_URL` for URL).
 */
function presetIntegrationEnvReady(): boolean {
  if (!process.env.SUPABASE_SECRET_KEY?.length) {
    return false;
  }
  try {
    getSupabaseUrl();
    getSupabasePublishableKey();
    return true;
  } catch {
    return false;
  }
}

const presetIntegrationReady = presetIntegrationEnvReady();
if (
  !presetIntegrationReady &&
  process.env.ABSTRACK_PRESET_INTEGRATION_LOG === '1'
) {
  console.info(
    '[preset-flows.integration] Skipped: need SUPABASE_SECRET_KEY plus URL and publishable key (see getSupabaseUrl / getSupabasePublishableKey in env-public.ts and docs/SUPABASE_CLOUD_DEVELOPER.md).',
  );
}

/**
 * Deletes disposable Auth users and surfaces `auth.admin.deleteUser` failures (rate limits,
 * network, etc.) so the suite does not silently leak users.
 * Failure lines omit emails unless `ABSTRACK_PRESET_INTEGRATION_LOG=1` (reduces PII in CI logs).
 */
async function deleteDisposableAuthUsers(
  adminClient: ReturnType<typeof getSupabaseAdminClient>,
  users: ReadonlyArray<{ id: string; label: string; email: string }>,
): Promise<void> {
  const logPii = process.env.ABSTRACK_PRESET_INTEGRATION_LOG === '1';
  const failures: string[] = [];
  for (const { id, label, email } of users) {
    const { error } = await adminClient.auth.admin.deleteUser(id);
    if (error) {
      const line = logPii
        ? `${label} id=${id} (${email}): ${error.message}`
        : `${label} id=${id}: ${error.message}`;
      failures.push(line);
    }
  }
  if (failures.length > 0) {
    throw new Error(
      `[preset-flows.integration] auth.admin.deleteUser failed — disposable users may remain in Auth:\n${failures.join('\n')}`,
    );
  }
  console.info(
    '[preset-flows.integration] Deleted disposable Auth users for this run.',
  );
}

describe.skipIf(!presetIntegrationReady)(
  'preset flows — RLS integration (Supabase Cloud)',
  () => {
    // Default per-test timeout is 5s; Supabase Cloud + CI need more headroom (scoped to this file).
    vi.setConfig({ hookTimeout: 120_000, testTimeout: 120_000 });

    const password = 'PresetIt!2345678';
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const emailA = `preset-it-a-${suffix}@example.com`;
    const emailB = `preset-it-b-${suffix}@example.com`;

    let admin: ReturnType<typeof getSupabaseAdminClient>;
    let url: string;
    let publishableKey: string;
    let userAId: string;
    let userBId: string;
    let clientA: AbstrackSupabaseClient;
    let clientB: AbstrackSupabaseClient;

    beforeAll(async () => {
      url = getSupabaseUrl();
      publishableKey = getSupabasePublishableKey();
      admin = getSupabaseAdminClient();

      const { data: createdA, error: errA } = await admin.auth.admin.createUser(
        {
          email: emailA,
          password,
          email_confirm: true,
        },
      );
      if (errA || !createdA.user) {
        throw errA ?? new Error('createUser A failed');
      }
      userAId = createdA.user.id;

      const { data: createdB, error: errB } = await admin.auth.admin.createUser(
        {
          email: emailB,
          password,
          email_confirm: true,
        },
      );
      if (errB || !createdB.user) {
        throw errB ?? new Error('createUser B failed');
      }
      userBId = createdB.user.id;

      clientA = createClient<Database>(url, publishableKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      }) as unknown as AbstrackSupabaseClient;
      clientB = createClient<Database>(url, publishableKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      }) as unknown as AbstrackSupabaseClient;

      const signA = await clientA.auth.signInWithPassword({
        email: emailA,
        password,
      });
      if (signA.error) {
        throw signA.error;
      }
      const signB = await clientB.auth.signInWithPassword({
        email: emailB,
        password,
      });
      if (signB.error) {
        throw signB.error;
      }

      console.info(
        '[preset-flows.integration] Created two disposable Auth users for this run (emails below). They are deleted in afterAll — you will not see them in the dashboard unless you pause the run.',
        { emailA, emailB, userAId, userBId },
      );
    }, 120_000);

    afterAll(async () => {
      await clientA?.auth.signOut();
      await clientB?.auth.signOut();
      if (!admin) {
        return;
      }
      const disposable: { id: string; label: string; email: string }[] = [];
      if (userAId) {
        disposable.push({ id: userAId, label: 'userA', email: emailA });
      }
      if (userBId) {
        disposable.push({ id: userBId, label: 'userB', email: emailB });
      }
      if (disposable.length > 0) {
        await deleteDisposableAuthUsers(admin, disposable);
      }
    }, 120_000);

    describe.sequential(
      'symptom preset — create, edit, delete, reorder',
      () => {
        let presetId: string | undefined;
        let line1Id: string | undefined;
        let line2Id: string | undefined;

        beforeAll(async () => {
          const createPreset = await createSymptomPreset(clientA, {
            user_id: userAId,
            name: `RLS symptom ${suffix}`,
          });
          if (!createPreset.ok) {
            throw new Error(
              `createSymptomPreset: ${createPreset.error.message}`,
            );
          }
          presetId = createPreset.data.id;

          const line1 = await createPresetSymptom(clientA, {
            preset_id: presetId,
            sort_order: 0,
            symptom_name: 'Nausea',
            response_type: 'yes_no',
          });
          if (!line1.ok) {
            throw new Error(
              `createPresetSymptom (line 1): ${line1.error.message}`,
            );
          }
          line1Id = line1.data.id;

          const line2 = await createPresetSymptom(clientA, {
            preset_id: presetId,
            sort_order: 1,
            symptom_name: 'Fatigue',
            response_type: 'free_text',
          });
          if (!line2.ok) {
            throw new Error(
              `createPresetSymptom (line 2): ${line2.error.message}`,
            );
          }
          line2Id = line2.data.id;
        });

        afterAll(async () => {
          if (presetId === undefined) {
            return;
          }
          await deleteSymptomPreset(clientA, presetId);
        });

        it('updates header and a line', async () => {
          const up = await updateSymptomPreset(clientA, presetId!, {
            name: `RLS symptom updated ${suffix}`,
          });
          expect(up.ok).toBe(true);

          const lineUp = await updatePresetSymptom(clientA, line1Id!, {
            symptom_name: 'Nausea (edited)',
          });
          expect(lineUp.ok).toBe(true);
        });

        it('stores plaintext PHI at rest; service role can read the same value (RLS is the access control)', async () => {
          const { data, error } = await admin
            .from('symptom_presets')
            .select('name')
            .eq('id', presetId!)
            .single();
          expect(error).toBeNull();
          expect(data?.name).toContain('RLS symptom updated');
        });

        it('reorders lines via RPC', async () => {
          const re = await reorderPresetSymptoms(clientA, presetId!, [
            line2Id!,
            line1Id!,
          ]);
          expect(re.ok).toBe(true);
          const list = await listPresetSymptomsForPreset(clientA, presetId!);
          if (!list.ok) {
            throw new Error(
              `listPresetSymptomsForPreset: ${list.error.message}`,
            );
          }
          expect(list.data.map((r) => r.id)).toEqual([line2Id!, line1Id!]);
        });

        it('deletes one line then the preset (cascade removes remaining lines)', async () => {
          const delLine = await deletePresetSymptom(clientA, line2Id!);
          expect(delLine.ok).toBe(true);
          const delPreset = await deleteSymptomPreset(clientA, presetId!);
          expect(delPreset.ok).toBe(true);
        });
      },
    );

    describe.sequential('symptom preset — cross-user denial', () => {
      let victimPresetId: string;

      beforeAll(async () => {
        const created = await createSymptomPreset(clientA, {
          user_id: userAId,
          name: `Victim preset ${suffix}`,
        });
        expect(created.ok).toBe(true);
        if (!created.ok) {
          throw new Error('setup victim preset failed');
        }
        victimPresetId = created.data.id;
        const victimLine = await createPresetSymptom(clientA, {
          preset_id: victimPresetId,
          sort_order: 0,
          symptom_name: 'Secret',
          response_type: 'yes_no',
        });
        expect(victimLine.ok).toBe(true);
        if (!victimLine.ok) {
          throw new Error(
            `setup victim preset line (createPresetSymptom): ${victimLine.error.message}`,
          );
        }
      });

      it('hides other user preset from select by id', async () => {
        const got = await getSymptomPresetById(clientB, victimPresetId);
        expect(got.ok).toBe(true);
        if (!got.ok) {
          return;
        }
        expect(got.data).toBeNull();
      });

      it('does not list other user presets', async () => {
        const list = await listSymptomPresets(clientB);
        expect(list.ok).toBe(true);
        if (!list.ok) {
          return;
        }
        expect(list.data.some((p) => p.id === victimPresetId)).toBe(false);
      });

      it('denies update of other user preset', async () => {
        const up = await updateSymptomPreset(clientB, victimPresetId, {
          name: 'pwned',
        });
        expect(up.ok).toBe(false);
        if (up.ok) {
          return;
        }
        expect(['permission_denied', 'not_found']).toContain(up.error.code);
      });

      it('denies insert into other user preset lines', async () => {
        const ins = await createPresetSymptom(clientB, {
          preset_id: victimPresetId,
          sort_order: 99,
          symptom_name: 'Inject',
          response_type: 'yes_no',
        });
        expect(ins.ok).toBe(false);
      });

      it('denies direct insert of other user_id on symptom_presets', async () => {
        const { error } = await clientB.from('symptom_presets').insert({
          user_id: userAId,
          name: 'impersonation',
        });
        expect(error).not.toBeNull();
      });

      afterAll(async () => {
        await deleteSymptomPreset(clientA, victimPresetId);
      });
    });

    describe.sequential(
      'health marker preset — create, edit, delete, reorder',
      () => {
        let hPresetId: string | undefined;
        let hm1: string | undefined;
        let hm2: string | undefined;

        beforeAll(async () => {
          const createPreset = await createHealthMarkerPreset(clientA, {
            user_id: userAId,
            name: `RLS markers ${suffix}`,
          });
          if (!createPreset.ok) {
            throw new Error(
              `createHealthMarkerPreset: ${createPreset.error.message}`,
            );
          }
          hPresetId = createPreset.data.id;

          const a = await createPresetHealthMarker(clientA, {
            preset_id: hPresetId,
            sort_order: 0,
            marker_kind: 'weight',
          });
          if (!a.ok) {
            throw new Error(
              `createPresetHealthMarker (line 1): ${a.error.message}`,
            );
          }
          hm1 = a.data.id;

          const b = await createPresetHealthMarker(clientA, {
            preset_id: hPresetId,
            sort_order: 1,
            marker_kind: 'bac',
          });
          if (!b.ok) {
            throw new Error(
              `createPresetHealthMarker (line 2): ${b.error.message}`,
            );
          }
          hm2 = b.data.id;
        });

        afterAll(async () => {
          if (hPresetId === undefined) {
            return;
          }
          await deleteHealthMarkerPreset(clientA, hPresetId);
        });

        it('updates header and a line', async () => {
          const up = await updateHealthMarkerPreset(clientA, hPresetId!, {
            name: `RLS markers updated ${suffix}`,
          });
          expect(up.ok).toBe(true);

          const lineUp = await updatePresetHealthMarker(clientA, hm1!, {
            marker_kind: 'custom',
            custom_name: 'Steps',
            custom_unit: 'count',
          });
          expect(lineUp.ok).toBe(true);
        });

        it('service role reads same plaintext name as stored', async () => {
          const { data, error } = await admin
            .from('health_marker_presets')
            .select('name')
            .eq('id', hPresetId!)
            .single();
          expect(error).toBeNull();
          expect(data?.name).toContain('RLS markers updated');
        });

        it('reorders lines via RPC', async () => {
          const re = await reorderPresetHealthMarkers(clientA, hPresetId!, [
            hm2!,
            hm1!,
          ]);
          expect(re.ok).toBe(true);
          const list = await listPresetHealthMarkersForPreset(
            clientA,
            hPresetId!,
          );
          if (!list.ok) {
            throw new Error(
              `listPresetHealthMarkersForPreset: ${list.error.message}`,
            );
          }
          expect(list.data.map((r) => r.id)).toEqual([hm2!, hm1!]);
        });

        it('deletes one line then the preset', async () => {
          const delLine = await deletePresetHealthMarker(clientA, hm2!);
          expect(delLine.ok).toBe(true);
          const delPreset = await deleteHealthMarkerPreset(clientA, hPresetId!);
          expect(delPreset.ok).toBe(true);
        });
      },
    );

    describe.sequential('health marker preset — cross-user denial', () => {
      let victimHId: string;

      beforeAll(async () => {
        const created = await createHealthMarkerPreset(clientA, {
          user_id: userAId,
          name: `Victim HM ${suffix}`,
        });
        expect(created.ok).toBe(true);
        if (!created.ok) {
          throw new Error('setup victim HM preset failed');
        }
        victimHId = created.data.id;
        const victimHmLine = await createPresetHealthMarker(clientA, {
          preset_id: victimHId,
          sort_order: 0,
          marker_kind: 'heart_rate',
        });
        expect(victimHmLine.ok).toBe(true);
        if (!victimHmLine.ok) {
          throw new Error(
            `setup victim HM preset line (createPresetHealthMarker): ${victimHmLine.error.message}`,
          );
        }
      });

      it('hides other user preset from select by id', async () => {
        const got = await getHealthMarkerPresetById(clientB, victimHId);
        expect(got.ok).toBe(true);
        if (!got.ok) {
          return;
        }
        expect(got.data).toBeNull();
      });

      it('denies update of other user preset', async () => {
        const up = await updateHealthMarkerPreset(clientB, victimHId, {
          name: 'pwned',
        });
        expect(up.ok).toBe(false);
        if (up.ok) {
          return;
        }
        expect(['permission_denied', 'not_found']).toContain(up.error.code);
      });

      it('denies insert into other user preset lines', async () => {
        const ins = await createPresetHealthMarker(clientB, {
          preset_id: victimHId,
          sort_order: 0,
          marker_kind: 'weight',
        });
        expect(ins.ok).toBe(false);
      });

      afterAll(async () => {
        await deleteHealthMarkerPreset(clientA, victimHId);
      });
    });

    describe.sequential('episode templates — CRUD and cross-user', () => {
      let etSymptomId: string | undefined;
      let etHmId: string | undefined;
      let etTemplateId: string | undefined;

      beforeAll(async () => {
        const sp = await createSymptomPreset(clientA, {
          user_id: userAId,
          name: `ET sym ${suffix}`,
        });
        expect(sp.ok).toBe(true);
        if (!sp.ok) {
          throw new Error(sp.error.message);
        }
        etSymptomId = sp.data.id;

        const hm = await createHealthMarkerPreset(clientA, {
          user_id: userAId,
          name: `ET hm ${suffix}`,
        });
        expect(hm.ok).toBe(true);
        if (!hm.ok) {
          throw new Error(hm.error.message);
        }
        etHmId = hm.data.id;

        const created = await createEpisodeTemplate(clientA, {
          user_id: userAId,
          name: `ABS Episode ${suffix}`,
          symptom_preset_id: etSymptomId!,
          health_marker_preset_id: etHmId!,
        });
        expect(created.ok).toBe(true);
        if (!created.ok) {
          throw new Error(created.error.message);
        }
        etTemplateId = created.data.id;
      });

      it('lists episode template with nested preset names', async () => {
        const list = await listEpisodeTemplates(clientA);
        expect(list.ok).toBe(true);
        if (!list.ok) {
          return;
        }
        const found = list.data.find((r) => r.id === etTemplateId!);
        expect(found).toBeDefined();
        expect(found?.symptom_preset.name).toContain(`ET sym ${suffix}`);
        expect(found?.health_marker_preset.name).toContain(`ET hm ${suffix}`);
      });

      it('updates episode template', async () => {
        const up = await updateEpisodeTemplate(clientA, etTemplateId!, {
          name: `Renamed ${suffix}`,
        });
        expect(up.ok).toBe(true);
        if (!up.ok) {
          return;
        }
        expect(up.data.name).toBe(`Renamed ${suffix}`);
      });

      it('hides other user template from get by id', async () => {
        const got = await getEpisodeTemplateById(clientB, etTemplateId!);
        expect(got.ok).toBe(true);
        if (!got.ok) {
          return;
        }
        expect(got.data).toBeNull();
      });

      it('deletes episode template', async () => {
        const del = await deleteEpisodeTemplate(clientA, etTemplateId!);
        expect(del.ok).toBe(true);
      });

      afterAll(async () => {
        if (etSymptomId !== undefined) {
          await deleteSymptomPreset(clientA, etSymptomId);
        }
        if (etHmId !== undefined) {
          await deleteHealthMarkerPreset(clientA, etHmId);
        }
      });
    });
  },
);
