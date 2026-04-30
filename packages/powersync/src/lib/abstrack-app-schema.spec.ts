import { abstrackPowerSyncSchema } from './abstrack-app-schema.js';

describe('abstrackPowerSyncSchema', () => {
  it('validates (tables match PowerSync column constraints)', () => {
    expect(() => abstrackPowerSyncSchema.validate()).not.toThrow();
  });
});
