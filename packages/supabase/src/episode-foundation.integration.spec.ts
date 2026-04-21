/**
 * Episode row + `episode_symptoms` persistence against **Supabase Cloud** with RLS (patient session).
 * Skips without `SUPABASE_SECRET_KEY` and public URL/key — see **docs/SUPABASE_CLOUD_DEVELOPER.md**.
 * Disposable user emails/ids are logged only when `ABSTRACK_PRESET_INTEGRATION_LOG=1` (avoids PII in CI).
 * `auth.admin.deleteUser` failure lines omit emails unless that flag is set.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { PresetSymptomRow } from '@abstrack/types';
import { createClient } from '@supabase/supabase-js';
import type { Database } from './lib/database.types.js';
import { getSupabasePublishableKey, getSupabaseUrl } from './lib/env-public.js';
import type { AbstrackSupabaseClient } from './lib/supabase-client-type.js';
import { getSupabaseAdminClient } from './admin.js';
import {
  cancelActiveEpisodeById,
  createEpisode,
  deleteEpisodeById,
  getEpisodeById,
} from './lib/episode-data.js';
import {
  listEpisodeSymptomsForEpisode,
  upsertEpisodeSymptomAnswer,
} from './lib/episode-symptom-data.js';
import {
  createHealthMarkerPreset,
  createPresetHealthMarker,
  createPresetSymptom,
  createSymptomPreset,
  deleteHealthMarkerPreset,
  deleteSymptomPreset,
} from './lib/preset-data.js';

function episodeFoundationEnvReady(): boolean {
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

const episodeFoundationReady = episodeFoundationEnvReady();
if (
  !episodeFoundationReady &&
  process.env.ABSTRACK_PRESET_INTEGRATION_LOG === '1'
) {
  console.info(
    '[episode-foundation.integration] Skipped: need SUPABASE_SECRET_KEY plus URL and publishable key (see docs/SUPABASE_CLOUD_DEVELOPER.md).',
  );
}

async function deleteDisposableAuthUsers(
  admin: ReturnType<typeof getSupabaseAdminClient>,
  users: ReadonlyArray<{ id: string; label: string; email: string }>,
): Promise<void> {
  const logPii = process.env.ABSTRACK_PRESET_INTEGRATION_LOG === '1';
  const failures: string[] = [];
  for (const { id, label, email } of users) {
    const { error } = await admin.auth.admin.deleteUser(id);
    if (error) {
      const line = logPii
        ? `${label} id=${id} (${email}): ${error.message}`
        : `${label} id=${id}: ${error.message}`;
      failures.push(line);
    }
  }
  if (failures.length > 0) {
    throw new Error(
      `[episode-foundation.integration] auth.admin.deleteUser failed:\n${failures.join('\n')}`,
    );
  }
}

describe.skipIf(!episodeFoundationReady)(
  'episode foundation — RLS integration (Supabase Cloud)',
  () => {
    vi.setConfig({ hookTimeout: 120_000, testTimeout: 120_000 });

    const password = 'EpisodeFound!234567';
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const emailA = `ep-found-a-${suffix}@example.com`;
    const emailB = `ep-found-b-${suffix}@example.com`;

    let admin: ReturnType<typeof getSupabaseAdminClient>;
    let url: string;
    let anonKey: string;
    let userAId: string;
    let userBId: string;
    let clientA: AbstrackSupabaseClient;
    let clientB: AbstrackSupabaseClient;

    beforeAll(async () => {
      url = getSupabaseUrl();
      anonKey = getSupabasePublishableKey();
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

      clientA = createClient<Database>(url, anonKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      }) as unknown as AbstrackSupabaseClient;
      clientB = createClient<Database>(url, anonKey, {
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

      if (process.env.ABSTRACK_PRESET_INTEGRATION_LOG === '1') {
        console.info('[episode-foundation.integration] Disposable users', {
          emailA,
          emailB,
          userAId,
          userBId,
        });
      }
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

    describe.sequential('owner session — create / read', () => {
      let symptomPresetId: string;
      let healthMarkerPresetId: string;
      let presetHealthMarkerLineId: string;
      let presetLineRow: PresetSymptomRow;
      let episodeId: string;

      beforeAll(async () => {
        const sp = await createSymptomPreset(clientA, {
          user_id: userAId,
          name: `Ep foundation sx ${suffix}`,
        });
        if (!sp.ok) {
          throw new Error(sp.error.message);
        }
        symptomPresetId = sp.data.id;

        const line = await createPresetSymptom(clientA, {
          preset_id: symptomPresetId,
          sort_order: 0,
          symptom_name: 'Nausea level',
          response_type: 'free_text',
        });
        if (!line.ok) {
          throw new Error(line.error.message);
        }
        presetLineRow = line.data;

        const hp = await createHealthMarkerPreset(clientA, {
          user_id: userAId,
          name: `Ep foundation hm ${suffix}`,
        });
        if (!hp.ok) {
          throw new Error(hp.error.message);
        }
        healthMarkerPresetId = hp.data.id;

        const hmLine = await createPresetHealthMarker(clientA, {
          preset_id: healthMarkerPresetId,
          sort_order: 0,
          marker_kind: 'heart_rate',
        });
        if (!hmLine.ok) {
          throw new Error(hmLine.error.message);
        }
        presetHealthMarkerLineId = hmLine.data.id;

        const ep = await createEpisode(clientA, {
          user_id: userAId,
          started_at: new Date().toISOString(),
          symptom_preset_id: symptomPresetId,
          health_marker_preset_id: healthMarkerPresetId,
        });
        if (!ep.ok) {
          throw new Error(ep.error.message);
        }
        episodeId = ep.data.id;
      });

      afterAll(async () => {
        if (episodeId) {
          await clientA.from('episodes').delete().eq('id', episodeId);
        }
        if (symptomPresetId) {
          await deleteSymptomPreset(clientA, symptomPresetId);
        }
        if (healthMarkerPresetId) {
          await deleteHealthMarkerPreset(clientA, healthMarkerPresetId);
        }
      });

      it('writes episode_symptoms and reads plaintext under the same session', async () => {
        const upsert = await upsertEpisodeSymptomAnswer(clientA, {
          userId: userAId,
          episodeId,
          line: presetLineRow,
          answer: { type: 'free_text', value: 'mild cramping' },
        });
        expect(upsert.ok).toBe(true);
        if (!upsert.ok) {
          return;
        }
        expect(upsert.data.response_text).toBe('mild cramping');

        const list = await listEpisodeSymptomsForEpisode(clientA, episodeId);
        expect(list.ok).toBe(true);
        if (!list.ok) {
          return;
        }
        expect(list.data).toHaveLength(1);
        expect(list.data[0]?.response_text).toBe('mild cramping');

        const got = await getEpisodeById(clientA, episodeId);
        expect(got.ok).toBe(true);
        if (got.ok) {
          expect(got.data?.id).toBe(episodeId);
          expect(got.data?.user_id).toBe(userAId);
        }
      });

      it('stores plaintext PHI at rest; service role can read the same value', async () => {
        const { data, error } = await admin
          .from('episode_symptoms')
          .select('response_text')
          .eq('episode_id', episodeId)
          .maybeSingle();
        expect(error).toBeNull();
        expect(data?.response_text).toBe('mild cramping');
      });

      it('cascades or unlinks related rows when canceling an active episode', async () => {
        const symptomInsert = await clientA
          .from('episode_symptoms')
          .insert({
            user_id: userAId,
            episode_id: episodeId,
            symptom_name: 'Nausea',
            response_type: 'yes_no',
            response_boolean: true,
            sort_order: 1,
          })
          .select('id')
          .single();
        expect(symptomInsert.error).toBeNull();
        const insertedSymptomId = symptomInsert.data?.id;
        expect(insertedSymptomId).toBeTruthy();

        const markerInsert = await clientA
          .from('health_markers')
          .insert({
            user_id: userAId,
            episode_id: episodeId,
            preset_health_marker_id: presetHealthMarkerLineId,
            marker_kind: 'heart_rate',
            value_numeric: 88,
            recorded_at: new Date().toISOString(),
          })
          .select('id')
          .single();
        expect(markerInsert.error).toBeNull();

        const foodInsert = await clientA
          .from('food_diary_entries')
          .insert({
            user_id: userAId,
            episode_id: episodeId,
            meal_tag: 'Snack',
            food_note: 'Banana and water',
            logged_at: new Date().toISOString(),
          })
          .select('id')
          .single();
        expect(foodInsert.error).toBeNull();
        const foodEntryId = foodInsert.data?.id;
        expect(foodEntryId).toBeTruthy();

        const mediaInsert = await clientA
          .from('episode_media')
          .insert({
            user_id: userAId,
            episode_id: episodeId,
            episode_symptom_id: insertedSymptomId ?? null,
            storage_object_key: `episode-media/${episodeId}/clip.mp4`,
            media_type: 'video',
          })
          .select('id')
          .single();
        expect(mediaInsert.error).toBeNull();

        const canceled = await cancelActiveEpisodeById(clientA, episodeId);
        expect(canceled.ok).toBe(true);
        if (!canceled.ok) {
          return;
        }
        expect(canceled.data.didCancel).toBe(true);

        const symptomsAfter = await clientA
          .from('episode_symptoms')
          .select('id')
          .eq('episode_id', episodeId);
        expect(symptomsAfter.error).toBeNull();
        expect(symptomsAfter.data ?? []).toHaveLength(0);

        const markersAfter = await clientA
          .from('health_markers')
          .select('id')
          .eq('episode_id', episodeId);
        expect(markersAfter.error).toBeNull();
        expect(markersAfter.data ?? []).toHaveLength(0);

        const mediaAfter = await clientA
          .from('episode_media')
          .select('id')
          .eq('episode_id', episodeId);
        expect(mediaAfter.error).toBeNull();
        expect(mediaAfter.data ?? []).toHaveLength(0);

        const foodAfter = await clientA
          .from('food_diary_entries')
          .select('episode_id')
          .eq('id', foodEntryId as string)
          .single();
        expect(foodAfter.error).toBeNull();
        expect(foodAfter.data?.episode_id).toBeNull();
      });

      it('deletes completed episodes via the general delete helper', async () => {
        const startedAt = new Date(Date.now() - 60_000).toISOString();
        const endedAt = new Date().toISOString();
        const ep = await createEpisode(clientA, {
          user_id: userAId,
          started_at: startedAt,
          ended_at: endedAt,
          symptom_preset_id: symptomPresetId,
          health_marker_preset_id: healthMarkerPresetId,
        });
        expect(ep.ok).toBe(true);
        if (!ep.ok) {
          return;
        }

        const deleted = await deleteEpisodeById(clientA, ep.data.id);
        expect(deleted.ok).toBe(true);
        if (!deleted.ok) {
          return;
        }
        expect(deleted.data.didDelete).toBe(true);

        const nowMissing = await getEpisodeById(clientA, ep.data.id);
        expect(nowMissing.ok).toBe(true);
        if (!nowMissing.ok) {
          return;
        }
        expect(nowMissing.data).toBeNull();
      });
    });

    describe('cross-user denial', () => {
      let victimEpisodeId: string;
      let victimSymptomPresetId: string;
      let victimHealthMarkerPresetId: string;
      let victimPresetLine: PresetSymptomRow;

      beforeAll(async () => {
        const sp = await createSymptomPreset(clientA, {
          user_id: userAId,
          name: `Victim ep sx ${suffix}`,
        });
        expect(sp.ok).toBe(true);
        if (!sp.ok) {
          throw new Error(sp.error.message);
        }
        victimSymptomPresetId = sp.data.id;

        const line = await createPresetSymptom(clientA, {
          preset_id: victimSymptomPresetId,
          sort_order: 0,
          symptom_name: 'Pain',
          response_type: 'yes_no',
        });
        expect(line.ok).toBe(true);
        if (!line.ok) {
          throw new Error(line.error.message);
        }
        victimPresetLine = line.data;

        const hp = await createHealthMarkerPreset(clientA, {
          user_id: userAId,
          name: `Victim ep hm ${suffix}`,
        });
        expect(hp.ok).toBe(true);
        if (!hp.ok) {
          throw new Error(hp.error.message);
        }
        victimHealthMarkerPresetId = hp.data.id;

        const ep = await createEpisode(clientA, {
          user_id: userAId,
          started_at: new Date().toISOString(),
          symptom_preset_id: victimSymptomPresetId,
          health_marker_preset_id: victimHealthMarkerPresetId,
        });
        expect(ep.ok).toBe(true);
        if (!ep.ok) {
          throw new Error(ep.error.message);
        }
        victimEpisodeId = ep.data.id;

        const up = await upsertEpisodeSymptomAnswer(clientA, {
          userId: userAId,
          episodeId: victimEpisodeId,
          line: victimPresetLine,
          answer: { type: 'yes_no', value: true },
        });
        expect(up.ok).toBe(true);
      });

      afterAll(async () => {
        if (victimEpisodeId) {
          await clientA.from('episodes').delete().eq('id', victimEpisodeId);
        }
        if (victimSymptomPresetId) {
          await deleteSymptomPreset(clientA, victimSymptomPresetId);
        }
        if (victimHealthMarkerPresetId) {
          await deleteHealthMarkerPreset(clientA, victimHealthMarkerPresetId);
        }
      });

      it('hides other user episode_symptoms rows', async () => {
        const list = await listEpisodeSymptomsForEpisode(
          clientB,
          victimEpisodeId,
        );
        expect(list.ok).toBe(true);
        if (!list.ok) {
          return;
        }
        expect(list.data).toHaveLength(0);
      });

      it('hides other user episode row from getEpisodeById', async () => {
        const got = await getEpisodeById(clientB, victimEpisodeId);
        expect(got.ok).toBe(true);
        if (!got.ok) {
          return;
        }
        expect(got.data).toBeNull();
      });

      it('does not allow deleting other user episode rows', async () => {
        const deleted = await deleteEpisodeById(clientB, victimEpisodeId);
        expect(deleted.ok).toBe(true);
        if (!deleted.ok) {
          return;
        }
        expect(deleted.data.didDelete).toBe(false);
      });
    });
  },
);
