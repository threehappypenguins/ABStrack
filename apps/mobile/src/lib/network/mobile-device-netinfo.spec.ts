import { mapNetInfoStateToAppOnline } from './mobile-device-netinfo';

describe('mapNetInfoStateToAppOnline', () => {
  it('returns false when not connected', () => {
    expect(
      mapNetInfoStateToAppOnline({
        type: 'none',
        isConnected: false,
        isInternetReachable: false,
        details: {},
      } as never),
    ).toBe(false);
  });

  it('returns false when connected but internet explicitly unreachable', () => {
    expect(
      mapNetInfoStateToAppOnline({
        type: 'wifi',
        isConnected: true,
        isInternetReachable: false,
        details: {},
      } as never),
    ).toBe(false);
  });

  it('returns true when connected with reachable internet', () => {
    expect(
      mapNetInfoStateToAppOnline({
        type: 'wifi',
        isConnected: true,
        isInternetReachable: true,
        details: {},
      } as never),
    ).toBe(true);
  });

  it('returns null when connected but reachability is still unknown', () => {
    expect(
      mapNetInfoStateToAppOnline({
        type: 'wifi',
        isConnected: true,
        isInternetReachable: null,
        details: {},
      } as never),
    ).toBeNull();
  });
});
