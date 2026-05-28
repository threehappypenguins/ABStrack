import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { announce } from '@abstrack/ui/native';
import {
  usePowerSyncBridgeState,
  usePowerSyncManualResync,
} from '../../lib/powersync/PowerSyncSessionBridge';
import { useMobileDeviceNetworkConnected } from '../../lib/network/use-mobile-device-network-connected';
import { usePowerSyncClientSyncStatus } from '../../lib/powersync/use-power-sync-client-sync-status';
import { useAppTheme } from '../theme/AppThemeContext';
import { nw } from '../theme/app-nativewind-classes';
import {
  userFacingSyncHealthBridgeOrClientError,
  userFacingSyncHealthStatusLine,
} from './sync-health-footer-user-messages';

function formatLastSyncedAt(value: Date | undefined): string {
  if (!value) {
    return 'Not yet';
  }
  return value.toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

type FooterPresentation = {
  line: string;
  tone: 'muted' | 'ink' | 'error' | 'primary';
  showSpinner: boolean;
  detailRecommended: boolean;
};

/**
 * Signed-in sync strip **only** when the device is offline, replication reports an error, the
 * stream is disconnected, or a manual reconnect is in progress **while offline** (online
 * pull-to-refresh already shows a list spinner; omitting the strip avoids tab-bar layout jump).
 * Hidden when online and healthy (no “Up to date” row). Tap opens a sheet with details and
 * **Sync now** (pull-to-refresh uses the same reconnect path). The detail sheet maps bridge /
 * PowerSync / upload / download errors to user-facing copy (raw SDK messages are not shown).
 *
 * @returns Footer + optional details modal, or `null` when PowerSync chrome is disabled or there
 * is nothing to surface.
 */
export function SyncHealthFooter() {
  const insets = useSafeAreaInsets();
  const { colors } = useAppTheme();
  const psBridge = usePowerSyncBridgeState();
  const client = usePowerSyncClientSyncStatus(psBridge.database);
  const { isConnected: deviceNetConnected } = useMobileDeviceNetworkConnected();
  const { requestManualResync, manualResyncBusy } = usePowerSyncManualResync();
  const [detailOpen, setDetailOpen] = useState(false);

  /**
   * True during the gap between NetInfo reporting online and PowerSync's status listener
   * confirming it has started connecting. In that window, stale client errors would otherwise
   * flash as "Sync issue" even though a reconnect is imminent. Cleared as soon as
   * client.connecting or client.connected becomes true, or if the device goes offline again.
   */
  const [justCameOnline, setJustCameOnline] = useState(false);
  const prevDeviceNetConnected = useRef(deviceNetConnected);
  useEffect(() => {
    const prev = prevDeviceNetConnected.current;
    prevDeviceNetConnected.current = deviceNetConnected;
    if (prev === false && deviceNetConnected === true) {
      // Network just came back — set the flag and let PowerSync's status clear it.
      setJustCameOnline(true);
    }
  }, [deviceNetConnected]);
  useEffect(() => {
    if (justCameOnline && (client?.connecting || client?.connected)) {
      setJustCameOnline(false);
    }
    if (justCameOnline && deviceNetConnected === false) {
      setJustCameOnline(false);
    }
  }, [
    justCameOnline,
    client?.connecting,
    client?.connected,
    deviceNetConnected,
  ]);

  const shouldShowFooter = useMemo(() => {
    if (!psBridge.syncChromeEnabled) {
      return false;
    }
    if (psBridge.syncError) {
      return true;
    }
    if (manualResyncBusy && deviceNetConnected === false) {
      return true;
    }
    if (!psBridge.database) {
      return false;
    }
    if (psBridge.syncConnecting) {
      return false;
    }
    const deviceOffline =
      deviceNetConnected === false && psBridge.localSqliteInitialized;
    // While PowerSync is actively reconnecting after coming back online, suppress the footer —
    // stale errors and the !connected state are expected during this window and would produce
    // misleading "Sync issue" or "Not connected" messages. Only suppress when online: if the
    // device is offline, client.connecting stays true indefinitely (PowerSync keeps retrying)
    // and we still want to show the "Offline" strip.
    if ((client?.connecting || justCameOnline) && !deviceOffline) {
      return false;
    }
    if (deviceOffline) {
      return true;
    }
    const uploadErr = client?.uploadError;
    const downloadErr = client?.downloadError;
    if (uploadErr ?? downloadErr) {
      return true;
    }
    if (
      client &&
      !client.connected &&
      !client.connecting &&
      psBridge.localSqliteInitialized
    ) {
      return true;
    }
    return false;
  }, [
    client,
    deviceNetConnected,
    justCameOnline,
    manualResyncBusy,
    psBridge.database,
    psBridge.localSqliteInitialized,
    psBridge.syncChromeEnabled,
    psBridge.syncConnecting,
    psBridge.syncError,
  ]);

  useEffect(() => {
    if (!shouldShowFooter && detailOpen) {
      setDetailOpen(false);
    }
  }, [detailOpen, shouldShowFooter]);

  const presentation = useMemo((): FooterPresentation => {
    if (!psBridge.syncChromeEnabled) {
      return {
        line: '',
        tone: 'muted',
        showSpinner: false,
        detailRecommended: false,
      };
    }
    if (manualResyncBusy && deviceNetConnected === false) {
      return {
        line: 'Reconnecting…',
        tone: 'primary',
        showSpinner: true,
        detailRecommended: false,
      };
    }
    if (!psBridge.database) {
      if (psBridge.syncError) {
        return {
          line: psBridge.firstSyncCompleted
            ? 'Sync issue — tap for details'
            : "Couldn't finish first sync — tap for details",
          tone: 'error',
          showSpinner: false,
          detailRecommended: true,
        };
      }
      return {
        line: 'Preparing replica…',
        tone: 'ink',
        showSpinner: true,
        detailRecommended: false,
      };
    }
    if (psBridge.syncConnecting) {
      return {
        line: 'Connecting…',
        tone: 'ink',
        showSpinner: true,
        detailRecommended: false,
      };
    }
    const deviceOffline =
      deviceNetConnected === false && psBridge.localSqliteInitialized;
    // PowerSync is actively reconnecting after coming back online — show a neutral
    // "Reconnecting…" rather than letting stale errors surface as "Sync issue".
    // Only suppress when online: if offline, client.connecting stays true indefinitely and
    // we still want to reach the "Offline — saved on device" branch below.
    if ((client?.connecting || justCameOnline) && !deviceOffline) {
      return {
        line: 'Reconnecting…',
        tone: 'ink',
        showSpinner: true,
        detailRecommended: false,
      };
    }

    if (deviceOffline) {
      return {
        line: 'Offline — saved on device; syncs when online',
        tone: 'muted',
        showSpinner: false,
        detailRecommended: false,
      };
    }

    const uploadErr = client?.uploadError;
    const downloadErr = client?.downloadError;
    if (uploadErr ?? downloadErr) {
      return {
        line: 'Sync issue — tap for details',
        tone: 'error',
        showSpinner: false,
        detailRecommended: true,
      };
    }
    if (psBridge.syncError) {
      return {
        line: psBridge.firstSyncCompleted
          ? 'Sync issue — tap for details'
          : "Couldn't finish first sync — tap for details",
        tone: 'error',
        showSpinner: false,
        detailRecommended: true,
      };
    }
    if (
      client &&
      !client.connected &&
      !client.connecting &&
      psBridge.localSqliteInitialized
    ) {
      return {
        line: 'Not connected — tap to retry',
        tone: 'error',
        showSpinner: false,
        detailRecommended: true,
      };
    }
    if (client?.uploading || client?.downloading) {
      return {
        line: 'Syncing…',
        tone: 'primary',
        showSpinner: true,
        detailRecommended: false,
      };
    }
    return {
      line: 'Up to date',
      tone: 'muted',
      showSpinner: false,
      detailRecommended: false,
    };
  }, [
    client,
    deviceNetConnected,
    justCameOnline,
    manualResyncBusy,
    psBridge.database,
    psBridge.firstSyncCompleted,
    psBridge.localSqliteInitialized,
    psBridge.syncChromeEnabled,
    psBridge.syncConnecting,
    psBridge.syncError,
  ]);

  const lineColor = useMemo(() => {
    switch (presentation.tone) {
      case 'error':
        return colors.error;
      case 'primary':
        return colors.primary;
      case 'ink':
        return colors.ink;
      default:
        return colors.muted;
    }
  }, [
    colors.error,
    colors.primary,
    colors.ink,
    colors.muted,
    presentation.tone,
  ]);

  const detailStatusLine = userFacingSyncHealthStatusLine(
    client?.statusMessage,
  );

  const onSyncNow = useCallback(async () => {
    if (!psBridge.database) {
      await announce('Sync is unavailable until the local database is ready.', {
        politeness: 'polite',
      });
      return;
    }
    const ok = await requestManualResync();
    if (ok) {
      await announce('Sync requested.', { politeness: 'polite' });
    } else {
      await announce(
        'Sync reconnect did not finish. Open sync details for status.',
        { politeness: 'assertive' },
      );
    }
  }, [psBridge.database, requestManualResync]);

  if (!psBridge.syncChromeEnabled) {
    return null;
  }

  if (!shouldShowFooter) {
    return null;
  }

  return (
    <>
      <View
        style={{
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
          borderTopWidth: StyleSheet.hairlineWidth,
        }}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Sync status: ${presentation.line}`}
          accessibilityHint="Opens sync details and sync now"
          onPress={() => {
            setDetailOpen(true);
          }}
          className="min-h-[44px] flex-row items-center justify-center gap-2 px-3 py-1.5"
        >
          {presentation.showSpinner ? (
            <ActivityIndicator size="small" color={colors.primary} />
          ) : null}
          <Text
            className="text-center text-xs font-medium"
            style={{ color: lineColor }}
            numberOfLines={1}
            ellipsizeMode="tail"
            maxFontSizeMultiplier={2}
            accessibilityLiveRegion="polite"
          >
            {presentation.line}
          </Text>
        </Pressable>
      </View>

      <Modal
        visible={detailOpen}
        transparent
        animationType="slide"
        onRequestClose={() => {
          setDetailOpen(false);
        }}
      >
        <View className="flex-1 justify-end">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Dismiss sync details"
            className="flex-1"
            onPress={() => {
              setDetailOpen(false);
            }}
          />
          <View
            style={{
              backgroundColor: colors.surface,
              borderTopLeftRadius: 16,
              borderTopRightRadius: 16,
              paddingHorizontal: 16,
              paddingTop: 16,
              paddingBottom: Math.max(insets.bottom, 16) + 8,
              borderTopColor: colors.border,
              borderTopWidth: StyleSheet.hairlineWidth,
            }}
          >
            <Text
              className={`mb-2 text-lg font-semibold ${nw.textInk}`}
              accessibilityRole="header"
              maxFontSizeMultiplier={2}
            >
              Sync details
            </Text>
            {deviceNetConnected === false ? (
              <Text
                className={`mb-2 text-sm ${nw.textInk}`}
                maxFontSizeMultiplier={2}
              >
                You are offline. This app keeps working with data stored on this
                device; it will sync to the cloud when you are connected again.
              </Text>
            ) : null}
            <Text
              className={`mb-1 text-sm ${nw.textMuted}`}
              maxFontSizeMultiplier={2}
            >
              Last full sync: {formatLastSyncedAt(client?.lastSyncedAt)}
            </Text>
            {detailStatusLine ? (
              <Text
                className={`mb-2 text-xs ${nw.textMuted}`}
                maxFontSizeMultiplier={2}
              >
                {detailStatusLine}
              </Text>
            ) : null}
            {psBridge.syncError ? (
              <Text
                className={`mb-2 text-sm ${nw.textError}`}
                accessibilityRole="alert"
                accessibilityLabel={userFacingSyncHealthBridgeOrClientError(
                  psBridge.syncError,
                )}
                maxFontSizeMultiplier={2}
              >
                {userFacingSyncHealthBridgeOrClientError(psBridge.syncError)}
              </Text>
            ) : null}
            {client?.uploadError ? (
              <Text
                className={`mb-1 text-sm ${nw.textError}`}
                accessibilityRole="alert"
                accessibilityLabel={`Upload: ${userFacingSyncHealthBridgeOrClientError(client.uploadError)}`}
                maxFontSizeMultiplier={2}
              >
                Upload:{' '}
                {userFacingSyncHealthBridgeOrClientError(client.uploadError)}
              </Text>
            ) : null}
            {client?.downloadError ? (
              <Text
                className={`mb-3 text-sm ${nw.textError}`}
                accessibilityRole="alert"
                accessibilityLabel={`Download: ${userFacingSyncHealthBridgeOrClientError(client.downloadError)}`}
                maxFontSizeMultiplier={2}
              >
                Download:{' '}
                {userFacingSyncHealthBridgeOrClientError(client.downloadError)}
              </Text>
            ) : null}

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Sync now"
              accessibilityState={{ disabled: manualResyncBusy }}
              disabled={manualResyncBusy}
              onPress={() => {
                void (async () => {
                  await onSyncNow();
                })();
              }}
              className={`mb-2 min-h-[48px] items-center justify-center rounded-xl px-4 ${nw.btnPrimary} ${manualResyncBusy ? 'opacity-60' : ''}`}
            >
              <Text className={`text-base font-semibold ${nw.textOnPrimary}`}>
                {manualResyncBusy ? 'Syncing…' : 'Sync now'}
              </Text>
            </Pressable>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close sync details"
              onPress={() => {
                setDetailOpen(false);
              }}
              className={`min-h-[48px] items-center justify-center rounded-xl border px-4 ${nw.btnSecondary}`}
            >
              <Text className={`text-base font-semibold ${nw.textPrimary}`}>
                Close
              </Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </>
  );
}
