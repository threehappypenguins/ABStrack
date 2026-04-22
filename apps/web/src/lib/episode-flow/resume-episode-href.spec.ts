import { buildResumeEpisodeHref } from './resume-episode-href';

describe('buildResumeEpisodeHref', () => {
  it('includes episode id, symptomPresetId, and resume=1', () => {
    const href = buildResumeEpisodeHref('ep-uuid', 'sym-uuid');
    const url = new URL(`https://example.test${href}`);
    expect(url.pathname).toBe('/episode/ep-uuid/symptoms');
    expect(url.searchParams.get('symptomPresetId')).toBe('sym-uuid');
    expect(url.searchParams.get('resume')).toBe('1');
  });

  it('builds direct health-marker resume link when requested', () => {
    const href = buildResumeEpisodeHref('ep-uuid', 'sym-uuid', {
      toHealthMarkers: true,
    });
    expect(href).toBe('/episode/ep-uuid/health-markers?resume=1');
  });
});
