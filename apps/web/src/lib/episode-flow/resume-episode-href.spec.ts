import { buildResumeEpisodeHref } from './resume-episode-href';

describe('buildResumeEpisodeHref', () => {
  it('includes episode id, symptomPresetId, and resume=1', () => {
    const href = buildResumeEpisodeHref('ep-uuid', 'sym-uuid');
    const url = new URL(`https://example.test${href}`);
    expect(url.pathname).toBe('/episode/ep-uuid/symptoms');
    expect(url.searchParams.get('symptomPresetId')).toBe('sym-uuid');
    expect(url.searchParams.get('resume')).toBe('1');
  });

  it('builds episode-hub health-marker resume link when requested', () => {
    const href = buildResumeEpisodeHref('ep-uuid', null, {
      toEpisodeHub: true,
    });
    const url = new URL(`https://example.test${href}`);
    expect(url.pathname).toBe('/episode/ep-uuid/health-markers');
    expect(url.searchParams.get('resume')).toBe('1');
    expect(url.searchParams.get('hub')).toBe('1');
  });

  it('throws when symptom resume has no symptomPresetId', () => {
    expect(() => buildResumeEpisodeHref('ep-uuid', null)).toThrow(
      'buildResumeEpisodeHref requires symptomPresetId when resuming to symptoms.',
    );
  });
});
