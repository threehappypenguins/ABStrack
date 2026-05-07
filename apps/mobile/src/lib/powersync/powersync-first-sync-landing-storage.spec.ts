import * as SecureStore from 'expo-secure-store';

import {
  clearPowerSyncFirstSyncLandedForUser,
  getPowerSyncFirstSyncLandedForUser,
} from './powersync-first-sync-landing-storage';

describe('powersync-first-sync-landing-storage', () => {
  beforeEach(() => {
    jest.mocked(SecureStore.getItemAsync).mockReset();
    jest.mocked(SecureStore.setItemAsync).mockReset();
    jest.mocked(SecureStore.deleteItemAsync).mockReset();
  });

  describe('getPowerSyncFirstSyncLandedForUser', () => {
    it('returns false when stored value is the post-logout invalidation sentinel', async () => {
      jest.mocked(SecureStore.getItemAsync).mockResolvedValue('0');
      await expect(getPowerSyncFirstSyncLandedForUser('u1')).resolves.toBe(
        false,
      );
    });

    it('returns true only when stored value is the landed sentinel', async () => {
      jest.mocked(SecureStore.getItemAsync).mockResolvedValue('1');
      await expect(getPowerSyncFirstSyncLandedForUser('u1')).resolves.toBe(
        true,
      );
    });
  });

  describe('clearPowerSyncFirstSyncLandedForUser', () => {
    it('resolves after delete succeeds without overwriting', async () => {
      jest.mocked(SecureStore.deleteItemAsync).mockResolvedValue(undefined);
      await expect(
        clearPowerSyncFirstSyncLandedForUser('u1'),
      ).resolves.toBeUndefined();
      expect(SecureStore.setItemAsync).not.toHaveBeenCalled();
    });

    it('overwrites with invalidation sentinel when delete fails', async () => {
      jest
        .mocked(SecureStore.deleteItemAsync)
        .mockRejectedValue(new Error('delete failed'));
      jest.mocked(SecureStore.setItemAsync).mockResolvedValue(undefined);
      await expect(
        clearPowerSyncFirstSyncLandedForUser('u1'),
      ).resolves.toBeUndefined();
      expect(SecureStore.setItemAsync).toHaveBeenCalledWith(
        expect.stringContaining('u1'),
        '0',
        expect.objectContaining({
          keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
        }),
      );
    });

    it('rejects when delete and overwrite both fail', async () => {
      jest
        .mocked(SecureStore.deleteItemAsync)
        .mockRejectedValue(new Error('delete failed'));
      jest
        .mocked(SecureStore.setItemAsync)
        .mockRejectedValue(new Error('overwrite failed'));
      await expect(clearPowerSyncFirstSyncLandedForUser('u1')).rejects.toThrow(
        /delete and overwrite both failed/i,
      );
    });
  });
});
