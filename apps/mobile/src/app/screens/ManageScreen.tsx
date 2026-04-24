import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Alert, FlatList, Pressable, Text, View } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import type { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import {
  useFocusEffect,
  useNavigation,
  useRoute,
} from '@react-navigation/native';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import type { RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { FoodDiaryEntryRow, HealthMarkerRow } from '@abstrack/types';
import { PRESET_HEALTH_MARKER_KIND_LABELS } from '@abstrack/types';
import { announce } from '@abstrack/ui/native';
import {
  deleteFoodDiaryEntry,
  deleteHealthMarkerById,
  listFoodDiaryEntriesForUser,
  listStandaloneHealthMarkersForUser,
} from '@abstrack/supabase';
import { getMobileSupabaseClient } from '../../lib/supabase-wiring';
import { ScreenShell } from '../components/ScreenShell';
import type { MainStackParamList, MainTabParamList } from '../navigation/types';
import { nw } from '../theme/app-nativewind-classes';
import {
  EpisodesManagementPanel,
  type EpisodesManagementNav,
} from './EpisodesManagementPanel';

const PAGE_SIZE = 30;

type ManageTabSegment = 'episodes' | 'health' | 'food';

function startOfLocalDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function endOfLocalDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

function formatInstant(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return iso.trim() === '' ? '—' : iso;
  }
  return d.toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

function healthMarkerTitle(row: HealthMarkerRow): string {
  if (row.marker_kind === 'custom') {
    const n = row.custom_name?.trim();
    return n && n.length > 0 ? n : PRESET_HEALTH_MARKER_KIND_LABELS.custom;
  }
  if (row.marker_kind === 'wellness_mood') {
    return 'Wellness mood';
  }
  return PRESET_HEALTH_MARKER_KIND_LABELS[
    row.marker_kind as keyof typeof PRESET_HEALTH_MARKER_KIND_LABELS
  ];
}

function healthMarkerValueLine(row: HealthMarkerRow): string {
  if (row.marker_kind === 'blood_pressure') {
    return `${row.systolic_numeric ?? '—'} / ${row.diastolic_numeric ?? '—'}`;
  }
  if (row.value_numeric != null) {
    const u = row.custom_unit?.trim();
    return u ? `${row.value_numeric} ${u}` : String(row.value_numeric);
  }
  return '—';
}

/**
 * Consolidated management: episodes, standalone health markers, and standalone food diary rows.
 *
 * @returns Manage tab root screen.
 */
export function ManageScreen() {
  const tabNavigation =
    useNavigation<BottomTabNavigationProp<MainTabParamList, 'Manage'>>();
  const stackNavigation =
    tabNavigation.getParent<NativeStackNavigationProp<MainStackParamList>>();
  if (!stackNavigation) {
    throw new Error(
      'ManageScreen: expected native stack parent for episode flows.',
    );
  }
  const route = useRoute<RouteProp<MainTabParamList, 'Manage'>>();
  const initialSegment = route.params?.initialSegment;

  const [segment, setSegment] = useState<ManageTabSegment>('episodes');
  const [filterDay, setFilterDay] = useState<Date | null>(null);
  const [pickerVisible, setPickerVisible] = useState(false);

  useEffect(() => {
    const requested =
      initialSegment === 'episodes' ||
      initialSegment === 'health' ||
      initialSegment === 'food'
        ? initialSegment
        : null;
    if (!requested) {
      return;
    }
    setSegment(requested);
    // Consume one-shot deep-link params so subsequent navigations can retarget segment.
    tabNavigation.setParams({ initialSegment: undefined });
  }, [initialSegment, tabNavigation]);

  const episodeDateBounds = useMemo(() => {
    if (!filterDay) {
      return {
        endedAtOrAfter: null as string | null,
        endedAtOrBefore: null as string | null,
      };
    }
    return {
      endedAtOrAfter: startOfLocalDay(filterDay).toISOString(),
      endedAtOrBefore: endOfLocalDay(filterDay).toISOString(),
    };
  }, [filterDay]);

  const markerDateBounds = useMemo(() => {
    if (!filterDay) {
      return {
        recordedAtOrAfter: null as string | null,
        recordedAtOrBefore: null as string | null,
      };
    }
    return {
      recordedAtOrAfter: startOfLocalDay(filterDay).toISOString(),
      recordedAtOrBefore: endOfLocalDay(filterDay).toISOString(),
    };
  }, [filterDay]);

  const foodDateBounds = useMemo(() => {
    if (!filterDay) {
      return {
        loggedAtOrAfter: null as string | null,
        loggedAtOrBefore: null as string | null,
      };
    }
    return {
      loggedAtOrAfter: startOfLocalDay(filterDay).toISOString(),
      loggedAtOrBefore: endOfLocalDay(filterDay).toISOString(),
    };
  }, [filterDay]);

  const onFilterDateChange = useCallback(
    (event: DateTimePickerEvent, date?: Date) => {
      if (event.type === 'dismissed') {
        setPickerVisible(false);
        return;
      }
      setPickerVisible(false);
      if (date) {
        setFilterDay(startOfLocalDay(date));
        void announce('Date filter applied.', { politeness: 'polite' });
      }
    },
    [],
  );

  const clearDateFilter = useCallback(() => {
    setFilterDay(null);
    void announce('Date filter cleared.', { politeness: 'polite' });
  }, []);

  const segmentTabs = (
    <View
      accessibilityRole="tablist"
      className="flex-row flex-wrap gap-2 rounded-xl border border-app-border bg-app-surface p-2 dark:border-app-border-dark dark:bg-app-surface-dark"
    >
      {(
        [
          { key: 'episodes' as const, label: 'Episodes' },
          { key: 'health' as const, label: 'Health' },
          { key: 'food' as const, label: 'Food' },
        ] as const
      ).map(({ key, label }) => {
        const selected = segment === key;
        return (
          <Pressable
            key={key}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            accessibilityLabel={`${label} records`}
            onPress={() => setSegment(key)}
            className={`min-h-[44px] flex-1 items-center justify-center rounded-lg px-3 py-2 ${
              selected ? `${nw.btnPrimary}` : ''
            }`}
          >
            <Text
              className={`text-center text-sm font-semibold ${
                selected ? nw.textOnPrimary : nw.textInk
              }`}
              maxFontSizeMultiplier={2}
            >
              {label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );

  const filterRow = (
    <View className="flex-row flex-wrap items-center gap-2">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Choose filter date"
        onPress={() => setPickerVisible(true)}
        className={`min-h-[44px] justify-center rounded-lg border border-app-border px-3 py-2 dark:border-app-border-dark`}
      >
        <Text className={`text-sm font-medium ${nw.textInk}`}>
          {filterDay
            ? `Date: ${filterDay.toLocaleDateString()}`
            : 'Filter by date'}
        </Text>
      </Pressable>
      {filterDay ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Clear date filter"
          onPress={clearDateFilter}
          className="min-h-[44px] justify-center rounded-lg px-3 py-2"
        >
          <Text className={`text-sm font-semibold ${nw.textPrimary}`}>
            Clear
          </Text>
        </Pressable>
      ) : null}
      {pickerVisible ? (
        <DateTimePicker
          value={filterDay ?? new Date()}
          mode="date"
          display="default"
          onChange={onFilterDateChange}
        />
      ) : null}
    </View>
  );

  return (
    <ScreenShell contentAlign="stretch">
      <View className="min-h-0 flex-1 gap-3">
        <Text
          className={`text-[22px] font-semibold ${nw.textInk}`}
          accessibilityRole="header"
          maxFontSizeMultiplier={2}
        >
          Manage
        </Text>
        <Text className={`text-sm ${nw.textMuted}`} maxFontSizeMultiplier={2}>
          Review and delete your episode history, standalone vitals, and food
          diary entries.
        </Text>
        {segmentTabs}
        {filterRow}
        <View className="min-h-0 flex-1">
          {segment === 'episodes' ? (
            <EpisodesManagementPanel
              navigation={stackNavigation as EpisodesManagementNav}
              variant="embedded"
              endedAtOrAfter={episodeDateBounds.endedAtOrAfter}
              endedAtOrBefore={episodeDateBounds.endedAtOrBefore}
            />
          ) : null}
          {segment === 'health' ? (
            <StandaloneHealthMarkersManageList
              recordedAtOrAfter={markerDateBounds.recordedAtOrAfter}
              recordedAtOrBefore={markerDateBounds.recordedAtOrBefore}
            />
          ) : null}
          {segment === 'food' ? (
            <StandaloneFoodDiaryManageList
              loggedAtOrAfter={foodDateBounds.loggedAtOrAfter}
              loggedAtOrBefore={foodDateBounds.loggedAtOrBefore}
            />
          ) : null}
        </View>
      </View>
    </ScreenShell>
  );
}

type StandaloneHealthMarkersManageListProps = {
  recordedAtOrAfter: string | null;
  recordedAtOrBefore: string | null;
};

function StandaloneHealthMarkersManageList({
  recordedAtOrAfter,
  recordedAtOrBefore,
}: StandaloneHealthMarkersManageListProps) {
  const loadGenRef = useRef(0);
  const [rows, setRows] = useState<HealthMarkerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const loadInitial = useCallback(
    async (cancel?: { cancelled: boolean }) => {
      const generation = ++loadGenRef.current;
      const stale = () =>
        cancel?.cancelled === true || generation !== loadGenRef.current;
      setLoading(true);
      setError(null);
      try {
        const client = getMobileSupabaseClient();
        const {
          data: { user },
        } = await client.auth.getUser();
        if (stale()) {
          return;
        }
        if (!user) {
          setRows([]);
          setHasMore(false);
          return;
        }
        const res = await listStandaloneHealthMarkersForUser(client, user.id, {
          limit: PAGE_SIZE,
          offset: 0,
          recordedAtOrAfter: recordedAtOrAfter ?? undefined,
          recordedAtOrBefore: recordedAtOrBefore ?? undefined,
        });
        if (stale()) {
          return;
        }
        if (!res.ok) {
          setError(res.error.message);
          setRows([]);
          setHasMore(false);
          return;
        }
        setRows(res.data);
        setHasMore(res.data.length === PAGE_SIZE);
      } catch {
        if (!stale()) {
          setError('Unable to load health markers.');
          setRows([]);
          setHasMore(false);
        }
      } finally {
        if (!stale()) {
          setLoading(false);
        }
      }
    },
    [recordedAtOrAfter, recordedAtOrBefore],
  );

  useFocusEffect(
    useCallback(() => {
      const cancel = { cancelled: false };
      void loadInitial(cancel);
      return () => {
        cancel.cancelled = true;
        loadGenRef.current += 1;
      };
    }, [loadInitial]),
  );

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore) {
      return;
    }
    const generation = loadGenRef.current;
    const stale = () => generation !== loadGenRef.current;
    setLoadingMore(true);
    try {
      const client = getMobileSupabaseClient();
      const {
        data: { user },
      } = await client.auth.getUser();
      if (stale()) {
        return;
      }
      if (!user) {
        setHasMore(false);
        return;
      }
      const res = await listStandaloneHealthMarkersForUser(client, user.id, {
        limit: PAGE_SIZE,
        offset: rows.length,
        recordedAtOrAfter: recordedAtOrAfter ?? undefined,
        recordedAtOrBefore: recordedAtOrBefore ?? undefined,
      });
      if (stale()) {
        return;
      }
      if (!res.ok) {
        await announce(res.error.message, { politeness: 'assertive' });
        return;
      }
      setRows((prev) => [...prev, ...res.data]);
      setHasMore(res.data.length === PAGE_SIZE);
    } catch {
      if (!stale()) {
        await announce('Unable to load more health markers.', {
          politeness: 'assertive',
        });
      }
    } finally {
      setLoadingMore(false);
    }
  }, [
    hasMore,
    loadingMore,
    recordedAtOrAfter,
    recordedAtOrBefore,
    rows.length,
  ]);

  const onDelete = useCallback(
    (row: HealthMarkerRow) => {
      if (deletingId) {
        return;
      }
      Alert.alert(
        'Delete this health marker?',
        'This permanently removes this standalone measurement. This cannot be undone.',
        [
          { text: 'Keep', style: 'cancel' },
          {
            text: 'Delete',
            style: 'destructive',
            onPress: () => {
              void (async () => {
                setDeletingId(row.id);
                try {
                  const client = getMobileSupabaseClient();
                  const res = await deleteHealthMarkerById(client, row.id);
                  if (!res.ok) {
                    await announce(res.error.message, {
                      politeness: 'assertive',
                    });
                    return;
                  }
                  await announce(
                    res.data
                      ? 'Health marker deleted.'
                      : 'Entry was already removed.',
                    { politeness: 'polite' },
                  );
                  await loadInitial();
                } finally {
                  setDeletingId(null);
                }
              })();
            },
          },
        ],
      );
    },
    [deletingId, loadInitial],
  );

  const onView = useCallback((row: HealthMarkerRow) => {
    const note = row.notes?.trim();
    Alert.alert(
      healthMarkerTitle(row),
      [
        `Measured: ${formatInstant(row.recorded_at)}`,
        `Value: ${healthMarkerValueLine(row)}`,
        note ? `Notes: ${note}` : null,
      ]
        .filter(Boolean)
        .join('\n'),
    );
  }, []);

  if (loading) {
    return <Text className={`py-4 text-sm ${nw.textMuted}`}>Loading…</Text>;
  }
  if (error) {
    return (
      <Text
        className={`py-2 text-sm ${nw.textError}`}
        accessibilityRole="alert"
      >
        {error}
      </Text>
    );
  }

  return (
    <FlatList
      style={{ flex: 1 }}
      data={rows}
      keyExtractor={(item) => item.id}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ paddingBottom: 24, gap: 12 }}
      onEndReachedThreshold={0.4}
      onEndReached={() => {
        if (hasMore && !loadingMore && rows.length > 0) {
          void loadMore();
        }
      }}
      ListEmptyComponent={
        <Text className={`text-sm ${nw.textMuted}`}>
          No standalone health markers yet. Log from Home or the Markers tab.
        </Text>
      }
      renderItem={({ item }) => (
        <View
          className={`rounded-xl border border-app-border bg-app-surface p-4 dark:border-app-border-dark dark:bg-app-surface-dark`}
        >
          <Text
            className="text-xs font-semibold uppercase text-app-muted"
            accessibilityLabel="Standalone health marker"
          >
            Standalone
          </Text>
          <Text className={`mt-1 text-base font-semibold ${nw.textInk}`}>
            {healthMarkerTitle(item)}
          </Text>
          <Text className={`mt-1 text-sm ${nw.textMuted}`}>
            {healthMarkerValueLine(item)}
          </Text>
          <Text className={`text-sm ${nw.textMuted}`}>
            Recorded {formatInstant(item.recorded_at)}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="View health marker details"
            onPress={() => onView(item)}
            className="mt-2 min-h-[44px] justify-center rounded-lg border border-app-border px-3 py-2 dark:border-app-border-dark"
          >
            <Text className={`text-sm font-semibold ${nw.textPrimary}`}>
              View details
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Delete this health marker"
            accessibilityState={{ disabled: deletingId === item.id }}
            onPress={() => onDelete(item)}
            disabled={deletingId === item.id}
            className="mt-2 min-h-[44px] justify-center self-start rounded-lg px-2"
          >
            <Text className="text-sm font-medium text-red-700 dark:text-red-300">
              {deletingId === item.id ? 'Deleting…' : 'Delete'}
            </Text>
          </Pressable>
        </View>
      )}
      ListFooterComponent={
        loadingMore ? (
          <Text className={`py-3 text-sm ${nw.textMuted}`}>Loading more…</Text>
        ) : null
      }
    />
  );
}

type StandaloneFoodDiaryManageListProps = {
  loggedAtOrAfter: string | null;
  loggedAtOrBefore: string | null;
};

function StandaloneFoodDiaryManageList({
  loggedAtOrAfter,
  loggedAtOrBefore,
}: StandaloneFoodDiaryManageListProps) {
  const loadGenRef = useRef(0);
  const [rows, setRows] = useState<FoodDiaryEntryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const loadInitial = useCallback(
    async (cancel?: { cancelled: boolean }) => {
      const generation = ++loadGenRef.current;
      const stale = () =>
        cancel?.cancelled === true || generation !== loadGenRef.current;
      setLoading(true);
      setError(null);
      try {
        const client = getMobileSupabaseClient();
        const {
          data: { user },
        } = await client.auth.getUser();
        if (stale()) {
          return;
        }
        if (!user) {
          setRows([]);
          setHasMore(false);
          return;
        }
        const res = await listFoodDiaryEntriesForUser(client, user.id, {
          limit: PAGE_SIZE,
          offset: 0,
          standaloneOnly: true,
          loggedAtOrAfter: loggedAtOrAfter ?? undefined,
          loggedAtOrBefore: loggedAtOrBefore ?? undefined,
        });
        if (stale()) {
          return;
        }
        if (!res.ok) {
          setError(res.error.message);
          setRows([]);
          setHasMore(false);
          return;
        }
        setRows(res.data);
        setHasMore(res.data.length === PAGE_SIZE);
      } catch {
        if (!stale()) {
          setError('Unable to load food diary entries.');
          setRows([]);
          setHasMore(false);
        }
      } finally {
        if (!stale()) {
          setLoading(false);
        }
      }
    },
    [loggedAtOrAfter, loggedAtOrBefore],
  );

  useFocusEffect(
    useCallback(() => {
      const cancel = { cancelled: false };
      void loadInitial(cancel);
      return () => {
        cancel.cancelled = true;
        loadGenRef.current += 1;
      };
    }, [loadInitial]),
  );

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore) {
      return;
    }
    const generation = loadGenRef.current;
    const stale = () => generation !== loadGenRef.current;
    setLoadingMore(true);
    try {
      const client = getMobileSupabaseClient();
      const {
        data: { user },
      } = await client.auth.getUser();
      if (stale()) {
        return;
      }
      if (!user) {
        setHasMore(false);
        return;
      }
      const res = await listFoodDiaryEntriesForUser(client, user.id, {
        limit: PAGE_SIZE,
        offset: rows.length,
        standaloneOnly: true,
        loggedAtOrAfter: loggedAtOrAfter ?? undefined,
        loggedAtOrBefore: loggedAtOrBefore ?? undefined,
      });
      if (stale()) {
        return;
      }
      if (!res.ok) {
        await announce(res.error.message, { politeness: 'assertive' });
        return;
      }
      setRows((prev) => [...prev, ...res.data]);
      setHasMore(res.data.length === PAGE_SIZE);
    } catch {
      if (!stale()) {
        await announce('Unable to load more food diary entries.', {
          politeness: 'assertive',
        });
      }
    } finally {
      setLoadingMore(false);
    }
  }, [hasMore, loadingMore, loggedAtOrAfter, loggedAtOrBefore, rows.length]);

  const onDelete = useCallback(
    (row: FoodDiaryEntryRow) => {
      if (deletingId) {
        return;
      }
      Alert.alert(
        'Delete this food diary entry?',
        'This permanently removes this entry. This cannot be undone.',
        [
          { text: 'Keep', style: 'cancel' },
          {
            text: 'Delete',
            style: 'destructive',
            onPress: () => {
              void (async () => {
                setDeletingId(row.id);
                try {
                  const client = getMobileSupabaseClient();
                  const res = await deleteFoodDiaryEntry(client, row.id);
                  if (!res.ok) {
                    await announce(res.error.message, {
                      politeness: 'assertive',
                    });
                    return;
                  }
                  await announce(
                    res.data
                      ? 'Food diary entry deleted.'
                      : 'Entry was already removed.',
                    { politeness: 'polite' },
                  );
                  await loadInitial();
                } finally {
                  setDeletingId(null);
                }
              })();
            },
          },
        ],
      );
    },
    [deletingId, loadInitial],
  );

  const onView = useCallback((row: FoodDiaryEntryRow) => {
    Alert.alert(
      `${row.meal_tag}`,
      [
        `Logged at: ${formatInstant(row.logged_at)}`,
        `Notes: ${row.food_note}`,
      ].join('\n'),
    );
  }, []);

  if (loading) {
    return <Text className={`py-4 text-sm ${nw.textMuted}`}>Loading…</Text>;
  }
  if (error) {
    return (
      <Text
        className={`py-2 text-sm ${nw.textError}`}
        accessibilityRole="alert"
      >
        {error}
      </Text>
    );
  }

  return (
    <FlatList
      style={{ flex: 1 }}
      data={rows}
      keyExtractor={(item) => item.id}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ paddingBottom: 24, gap: 12 }}
      onEndReachedThreshold={0.4}
      onEndReached={() => {
        if (hasMore && !loadingMore && rows.length > 0) {
          void loadMore();
        }
      }}
      ListEmptyComponent={
        <Text className={`text-sm ${nw.textMuted}`}>
          No standalone food diary entries yet.
        </Text>
      }
      renderItem={({ item }) => (
        <View
          className={`rounded-xl border border-app-border bg-app-surface p-4 dark:border-app-border-dark dark:bg-app-surface-dark`}
        >
          <Text
            className="text-xs font-semibold uppercase text-app-muted"
            accessibilityLabel="Standalone food diary entry"
          >
            Standalone · {item.meal_tag}
          </Text>
          <Text className={`mt-1 text-base ${nw.textInk}`}>
            {item.food_note}
          </Text>
          <Text className={`mt-1 text-sm ${nw.textMuted}`}>
            Logged {formatInstant(item.logged_at)}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="View food diary details"
            onPress={() => onView(item)}
            className="mt-2 min-h-[44px] justify-center rounded-lg border border-app-border px-3 py-2 dark:border-app-border-dark"
          >
            <Text className={`text-sm font-semibold ${nw.textPrimary}`}>
              View details
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Delete this food diary entry"
            accessibilityState={{ disabled: deletingId === item.id }}
            onPress={() => onDelete(item)}
            disabled={deletingId === item.id}
            className="mt-2 min-h-[44px] justify-center self-start rounded-lg px-2"
          >
            <Text className="text-sm font-medium text-red-700 dark:text-red-300">
              {deletingId === item.id ? 'Deleting…' : 'Delete'}
            </Text>
          </Pressable>
        </View>
      )}
      ListFooterComponent={
        loadingMore ? (
          <Text className={`py-3 text-sm ${nw.textMuted}`}>Loading more…</Text>
        ) : null
      }
    />
  );
}
