import { buildResumeEpisodeHref } from './resume-episode-href';

describe('buildResumeEpisodeHref', () => {
  it('includes episode id, symptomPresetId, and resume=1', () => {
    const href = buildResumeEpisodeHref('ep-uuid', 'sym-uuid');
    expect(href).toBe(
      '/episode/ep-uuid/symptoms?symptomPresetId=sym-uuid&resume=1',
    );
  });
});
