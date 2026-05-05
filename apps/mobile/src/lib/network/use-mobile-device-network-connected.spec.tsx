import type { NetInfoState } from '@react-native-community/netinfo';
import NetInfo from '@react-native-community/netinfo';
import React from 'react';
import { Text } from 'react-native';
import { render, waitFor } from '@testing-library/react-native';

import { useMobileDeviceNetworkConnected } from './use-mobile-device-network-connected';

function wifiOnline(): NetInfoState {
  return {
    type: 'wifi',
    isConnected: true,
    isInternetReachable: true,
    details: {},
  } as NetInfoState;
}

function noneOffline(): NetInfoState {
  return {
    type: 'none',
    isConnected: false,
    isInternetReachable: false,
    details: null,
  } as unknown as NetInfoState;
}

function Host() {
  const { isConnected } = useMobileDeviceNetworkConnected();
  return (
    <Text testID="net">
      {isConnected === null ? 'null' : String(isConnected)}
    </Text>
  );
}

describe('useMobileDeviceNetworkConnected', () => {
  beforeEach(() => {
    jest.mocked(NetInfo.addEventListener).mockReset();
    jest.mocked(NetInfo.fetch).mockReset();
  });

  it('does not let a stale fetch overwrite a newer listener snapshot', async () => {
    let resolveFetch!: (state: NetInfoState) => void;
    const fetchPromise = new Promise<NetInfoState>((resolve) => {
      resolveFetch = resolve;
    });

    jest.mocked(NetInfo.fetch).mockImplementation(() => fetchPromise);
    jest.mocked(NetInfo.addEventListener).mockImplementation((callback) => {
      callback(wifiOnline());
      return jest.fn();
    });

    const { getByTestId } = render(<Host />);

    await waitFor(() => {
      expect(getByTestId('net').props.children).toBe('true');
    });

    resolveFetch(noneOffline());
    await waitFor(() => Promise.resolve());

    expect(getByTestId('net').props.children).toBe('true');
  });

  it('applies fetch when no listener snapshot arrived during fetch', async () => {
    jest
      .mocked(NetInfo.fetch)
      .mockResolvedValue(
        wifiOnline() as Awaited<ReturnType<typeof NetInfo.fetch>>,
      );
    jest.mocked(NetInfo.addEventListener).mockImplementation(() => jest.fn());

    const { getByTestId } = render(<Host />);

    await waitFor(() => {
      expect(getByTestId('net').props.children).toBe('true');
    });
  });

  it('applies fetch when the only pre-fetch listener snapshots map to unknown-reachability (wifi connected)', async () => {
    jest
      .mocked(NetInfo.fetch)
      .mockResolvedValue(
        wifiOnline() as Awaited<ReturnType<typeof NetInfo.fetch>>,
      );
    jest.mocked(NetInfo.addEventListener).mockImplementation((callback) => {
      callback({
        type: 'wifi',
        isConnected: true,
        isInternetReachable: null,
        details: {},
      } as NetInfoState);
      return jest.fn();
    });

    const { getByTestId } = render(<Host />);

    await waitFor(() => {
      expect(getByTestId('net').props.children).toBe('true');
    });
  });

  it('applies fetch when the only pre-fetch listener snapshots map to unknown (null)', async () => {
    jest
      .mocked(NetInfo.fetch)
      .mockResolvedValue(
        wifiOnline() as Awaited<ReturnType<typeof NetInfo.fetch>>,
      );
    jest.mocked(NetInfo.addEventListener).mockImplementation((callback) => {
      callback({
        type: 'unknown',
        isConnected: null,
        isInternetReachable: null,
        details: null,
      } as NetInfoState);
      return jest.fn();
    });

    const { getByTestId } = render(<Host />);

    await waitFor(() => {
      expect(getByTestId('net').props.children).toBe('true');
    });
  });

  it('does not replace a resolved listener value with a later unknown snapshot', async () => {
    let netCallback: ((state: NetInfoState) => void) | undefined;
    jest
      .mocked(NetInfo.fetch)
      .mockResolvedValue(
        wifiOnline() as Awaited<ReturnType<typeof NetInfo.fetch>>,
      );
    jest.mocked(NetInfo.addEventListener).mockImplementation((callback) => {
      netCallback = callback;
      callback(wifiOnline());
      return jest.fn();
    });

    const { getByTestId } = render(<Host />);
    await waitFor(() => {
      expect(getByTestId('net').props.children).toBe('true');
    });

    if (netCallback === undefined) {
      throw new Error('Expected NetInfo.addEventListener callback');
    }
    netCallback({
      type: 'unknown',
      isConnected: null,
      isInternetReachable: null,
      details: null,
    } as NetInfoState);

    expect(getByTestId('net').props.children).toBe('true');
  });

  it('does not replace fetch-established connectivity with a later unknown listener snapshot', async () => {
    let netCallback: ((state: NetInfoState) => void) | undefined;
    jest
      .mocked(NetInfo.fetch)
      .mockResolvedValue(
        wifiOnline() as Awaited<ReturnType<typeof NetInfo.fetch>>,
      );
    jest.mocked(NetInfo.addEventListener).mockImplementation((callback) => {
      netCallback = callback;
      return jest.fn();
    });

    const { getByTestId } = render(<Host />);
    await waitFor(() => {
      expect(getByTestId('net').props.children).toBe('true');
    });

    if (netCallback === undefined) {
      throw new Error('Expected NetInfo.addEventListener callback');
    }
    netCallback({
      type: 'unknown',
      isConnected: null,
      isInternetReachable: null,
      details: null,
    } as NetInfoState);

    expect(getByTestId('net').props.children).toBe('true');
  });
});
