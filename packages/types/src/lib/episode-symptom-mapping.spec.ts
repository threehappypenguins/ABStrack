import { describe, expect, it } from 'vitest';
import type { EpisodeSymptomRow } from './types.js';
import {
  canonicalOpenPassEpisodeSymptomRowsByPresetLine,
  episodeMediaStoragePathHintsFromPromptAnswer,
  episodeSymptomRowToPromptAnswer,
  episodeSymptomRowsToAnswersMap,
  symptomPromptAnswerToResponseColumns,
} from './episode-symptom-mapping.js';

const baseRow = {
  id: 'es-1',
  user_id: 'u1',
  episode_id: 'ep-1',
  preset_symptom_id: 'ps-1',
  symptom_name: 'Nausea',
  created_at: '2026-04-18T12:00:00.000Z',
  updated_at: '2026-04-18T12:00:00.000Z',
  sort_order: 0,
} satisfies Partial<EpisodeSymptomRow>;

describe('episode-symptom mapping', () => {
  it('episodeMediaStoragePathHintsFromPromptAnswer collects primary and thumbnail storage refs', () => {
    expect(
      episodeMediaStoragePathHintsFromPromptAnswer({
        type: 'video',
        value: {
          localUri: 'storage:a/b/video.webm',
          thumbnailStorageUri: 'storage:a/b/thumb.jpg',
          durationMs: 3000,
          capturedAt: '2026-04-18T12:00:00.000Z',
        },
      }),
    ).toEqual(['storage:a/b/video.webm', 'storage:a/b/thumb.jpg']);
    expect(episodeMediaStoragePathHintsFromPromptAnswer(undefined)).toEqual([]);
  });

  it('episodeSymptomRowToPromptAnswer maps yes_no / severity / free_text', () => {
    expect(
      episodeSymptomRowToPromptAnswer({
        ...baseRow,
        response_type: 'yes_no',
        response_boolean: true,
        response_severity: null,
        response_text: null,
      } as EpisodeSymptomRow),
    ).toEqual({ type: 'yes_no', value: true });

    expect(
      episodeSymptomRowToPromptAnswer({
        ...baseRow,
        response_type: 'severity_scale',
        response_boolean: null,
        response_severity: 3,
        response_text: null,
      } as EpisodeSymptomRow),
    ).toEqual({ type: 'severity_scale', value: 3 });

    expect(
      episodeSymptomRowToPromptAnswer({
        ...baseRow,
        response_type: 'free_text',
        response_boolean: null,
        response_severity: null,
        response_text: 'hello',
      } as EpisodeSymptomRow),
    ).toEqual({ type: 'free_text', value: 'hello' });
  });

  it('symptomPromptAnswerToResponseColumns satisfies CHECK shape', () => {
    expect(
      symptomPromptAnswerToResponseColumns({ type: 'yes_no', value: false }),
    ).toEqual({
      response_type: 'yes_no',
      response_boolean: false,
      response_severity: null,
      response_text: null,
    });
    expect(
      symptomPromptAnswerToResponseColumns({ type: 'free_text', value: 'x' }),
    ).toEqual({
      response_type: 'free_text',
      response_boolean: null,
      response_severity: null,
      response_text: 'x',
    });
  });

  it('episodeSymptomRowsToAnswersMap keys by preset_symptom_id', () => {
    const map = episodeSymptomRowsToAnswersMap([
      {
        ...baseRow,
        id: 'a',
        preset_symptom_id: 'ps-1',
        response_type: 'yes_no',
        response_boolean: true,
        response_severity: null,
        response_text: null,
      } as EpisodeSymptomRow,
    ]);
    expect(map['ps-1']).toEqual({ type: 'yes_no', value: true });
  });

  it('episodeSymptomRowsToAnswersMap keeps newest duplicate per preset_symptom_id', () => {
    const older = {
      ...baseRow,
      id: '00000000-0000-4000-8000-000000000001',
      preset_symptom_id: 'ps-1',
      created_at: '2026-04-18T12:00:00.000Z',
      response_type: 'yes_no' as const,
      response_boolean: false,
      response_severity: null,
      response_text: null,
    } as EpisodeSymptomRow;
    const newer = {
      ...baseRow,
      id: '00000000-0000-4000-8000-000000000002',
      preset_symptom_id: 'ps-1',
      created_at: '2026-04-18T12:00:01.000Z',
      response_type: 'yes_no' as const,
      response_boolean: true,
      response_severity: null,
      response_text: null,
    } as EpisodeSymptomRow;

    expect(episodeSymptomRowsToAnswersMap([older, newer])['ps-1']).toEqual({
      type: 'yes_no',
      value: true,
    });
    expect(episodeSymptomRowsToAnswersMap([newer, older])['ps-1']).toEqual({
      type: 'yes_no',
      value: true,
    });
  });

  it('episodeSymptomRowsToAnswersMap breaks created_at ties with id DESC', () => {
    const lowerId = {
      ...baseRow,
      id: '00000000-0000-4000-8000-000000000001',
      preset_symptom_id: 'ps-1',
      created_at: '2026-04-18T12:00:00.000Z',
      response_type: 'yes_no' as const,
      response_boolean: false,
      response_severity: null,
      response_text: null,
    } as EpisodeSymptomRow;
    const higherId = {
      ...baseRow,
      id: '00000000-0000-4000-8000-000000000002',
      preset_symptom_id: 'ps-1',
      created_at: '2026-04-18T12:00:00.000Z',
      response_type: 'yes_no' as const,
      response_boolean: true,
      response_severity: null,
      response_text: null,
    } as EpisodeSymptomRow;

    expect(episodeSymptomRowsToAnswersMap([lowerId, higherId])['ps-1']).toEqual(
      {
        type: 'yes_no',
        value: true,
      },
    );
  });

  it('canonicalOpenPassEpisodeSymptomRowsByPresetLine picks newest row per preset in pass', () => {
    const boundary = '2026-04-17T00:00:00.000Z';
    const olderInPass = {
      ...baseRow,
      id: '00000000-0000-4000-8000-000000000001',
      preset_symptom_id: 'ps-1',
      created_at: '2026-04-18T10:00:00.000Z',
      response_type: 'photo' as const,
      response_boolean: null,
      response_severity: null,
      response_text: null,
    } as EpisodeSymptomRow;
    const newerInPass = {
      ...baseRow,
      id: '00000000-0000-4000-8000-000000000002',
      preset_symptom_id: 'ps-1',
      created_at: '2026-04-18T11:00:00.000Z',
      response_type: 'photo' as const,
      response_boolean: null,
      response_severity: null,
      response_text: null,
    } as EpisodeSymptomRow;
    const beforeBoundary = {
      ...baseRow,
      id: '00000000-0000-4000-8000-000000000099',
      preset_symptom_id: 'ps-1',
      created_at: '2026-04-16T12:00:00.000Z',
      response_type: 'photo' as const,
      response_boolean: null,
      response_severity: null,
      response_text: null,
    } as EpisodeSymptomRow;

    const canonical = canonicalOpenPassEpisodeSymptomRowsByPresetLine(
      [olderInPass, newerInPass, beforeBoundary],
      boundary,
    );
    expect(canonical['ps-1']?.id).toBe(newerInPass.id);
  });

  it('canonicalOpenPassEpisodeSymptomRowsByPresetLine order of input does not change canonical id', () => {
    const boundary = '2026-04-17T00:00:00.000Z';
    const olderInPass = {
      ...baseRow,
      id: '00000000-0000-4000-8000-000000000001',
      preset_symptom_id: 'ps-1',
      created_at: '2026-04-18T10:00:00.000Z',
      response_type: 'video' as const,
      response_boolean: null,
      response_severity: null,
      response_text: null,
    } as EpisodeSymptomRow;
    const newerInPass = {
      ...baseRow,
      id: '00000000-0000-4000-8000-000000000002',
      preset_symptom_id: 'ps-1',
      created_at: '2026-04-18T11:00:00.000Z',
      response_type: 'video' as const,
      response_boolean: null,
      response_severity: null,
      response_text: null,
    } as EpisodeSymptomRow;

    expect(
      canonicalOpenPassEpisodeSymptomRowsByPresetLine(
        [newerInPass, olderInPass],
        boundary,
      )['ps-1']?.id,
    ).toBe(newerInPass.id);
    expect(
      canonicalOpenPassEpisodeSymptomRowsByPresetLine(
        [olderInPass, newerInPass],
        boundary,
      )['ps-1']?.id,
    ).toBe(newerInPass.id);
  });
});
