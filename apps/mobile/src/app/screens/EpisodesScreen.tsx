import React, { useCallback, useRef, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { EpisodeRow } from '@abstrack/types';
import {
  getActiveEpisodeForUser,
  listCompletedEpisodesForUser,
} from '@abstrack/supabase';
import { getMobileSupabaseClient } from '../../lib/supabase-wiring';
import { ScreenShell } from '../components/ScreenShell';
import type { MainStackParamList } from '../navigation/types';
import type { ActiveEpisodeHomeSummary } from '../components/episode-flow/EpisodeStartHomeCta';
import { nw } from '../theme/app-nativewind-classes';

type EpisodesNav = NativeStackNavigationProp<MainStackParamList, 'Episodes'>;

function episodeSummaryLine(ep: {
  episode_type: string;
  episode_label: string | null;
}): string {
  const label = ep.episode_label?.trim();
  return label ? `${ep.episode_type} — ${label}` : ep.episode_type;
}

function formatInstant(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

/**
 * Secondary surface for episode lifecycle: active row (with resume) and ended history.
 *
 * @returns Episodes list screen.
 */
export function EpisodesScreen() {
  const navigation = useNavigation<EpisodesNav>();
  const loadGenRef = useRef(0);
  const [loading, setLoading] = useState(true);
  const [activeError, setActiveError] = useState<string | null>(null);
  const [recentError, setRecentError] = useState<string | null>(null);
  const [active, setActive] = useState<EpisodeRow | null>(null);
  const [recent, setRecent] = useState<EpisodeRow[]>([]);

  const load = useCallback(async (cancel?: { cancelled: boolean }) => {
    const generation = ++loadGenRef.current;
    const stale = () =>
      cancel?.cancelled === true || generation !== loadGenRef.current;

    setLoading(true);
    setActiveError(null);
    setRecentError(null);

    try {
      const client = getMobileSupabaseClient();
      const {
        data: { user },
      } = await client.auth.getUser();
      if (stale()) {
        return;
      }
      if (!user) {
        setActive(null);
        setRecent([]);
        return;
      }

      const [activeRes, recentRes] = await Promise.all([
        getActiveEpisodeForUser(client, user.id),
        listCompletedEpisodesForUser(client, user.id, { limit: 25 }),
      ]);

      if (stale()) {
        return;
      }

      if (!activeRes.ok) {
        setActiveError(activeRes.error.message);
        setActive(null);
      } else {
        setActive(activeRes.data);
      }

      if (!recentRes.ok) {
        setRecentError(recentRes.error.message);
        setRecent([]);
      } else {
        setRecent(recentRes.data);
      }
    } catch {
      if (!stale()) {
        const message = 'Unable to load episodes.';
        setActiveError(message);
        setRecentError(message);
        setActive(null);
        setRecent([]);
      }
    } finally {
      if (!stale()) {
        setLoading(false);
      }
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      const cancel = { cancelled: false };
      void load(cancel);
      return () => {
        cancel.cancelled = true;
        loadGenRef.current += 1;
      };
    }, [load]),
  );

  const onResume = (episode: ActiveEpisodeHomeSummary) => {
    navigation.navigate('SymptomPrompt', {
      episodeId: episode.episodeId,
      symptomPresetId: episode.symptomPresetId,
      resume: true,
    });
  };

  const resumeSummary: ActiveEpisodeHomeSummary | null =
    active && active.symptom_preset_id
      ? {
          episodeId: active.id,
          symptomPresetId: active.symptom_preset_id,
        }
      : null;

  return (
    <ScreenShell contentAlign="stretch">
      <ScrollView
        className="min-h-0 flex-1"
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingBottom: 24, gap: 16 }}
      >
        <Text
          className={`text-[22px] font-semibold ${nw.textInk}`}
          accessibilityRole="header"
          maxFontSizeMultiplier={2}
        >
          Episodes
        </Text>
        <Text className={`text-base ${nw.textMuted}`} maxFontSizeMultiplier={2}>
          Active and recent episodes. Resume continues the guided symptom flow.
        </Text>

        <View>
          <Text
            className={`text-lg font-semibold ${nw.textInk}`}
            accessibilityRole="header"
            maxFontSizeMultiplier={2}
          >
            Active episode
          </Text>
          {loading ? (
            <Text className={`mt-2 text-sm ${nw.textMuted}`}>Loading…</Text>
          ) : null}
          {activeError ? (
            <Text
              className={`mt-2 text-sm ${nw.textError}`}
              accessibilityRole="alert"
              maxFontSizeMultiplier={2}
            >
              {activeError}
            </Text>
          ) : null}
          {!loading && !activeError && active === null ? (
            <Text className={`mt-2 text-sm ${nw.textMuted}`}>
              No episode in progress.
            </Text>
          ) : null}
          {!loading && !activeError && active !== null ? (
            <View
              className={`mt-3 gap-2 rounded-2xl border-2 border-emerald-600/45 bg-emerald-50 p-4 dark:border-emerald-500/45 dark:bg-emerald-950/50`}
              accessibilityLabel="Active episode"
            >
              <Text
                className="text-xs font-semibold uppercase text-emerald-800 dark:text-emerald-200"
                maxFontSizeMultiplier={2}
              >
                In progress
              </Text>
              <Text
                className={`text-base font-semibold ${nw.textInk}`}
                maxFontSizeMultiplier={2}
              >
                {episodeSummaryLine(active)}
              </Text>
              <Text
                className={`text-sm ${nw.textMuted}`}
                maxFontSizeMultiplier={2}
              >
                Started {formatInstant(active.started_at)}
              </Text>
              <Text
                className={`text-sm ${nw.textMuted}`}
                maxFontSizeMultiplier={2}
              >
                Ended —
              </Text>
              {resumeSummary ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Resume this episode"
                  onPress={() => onResume(resumeSummary)}
                  className={`mt-2 min-h-[52px] items-center justify-center rounded-xl bg-emerald-700 px-4 py-3 dark:bg-emerald-600`}
                >
                  <Text className="text-center text-[17px] font-semibold text-white">
                    Resume this episode
                  </Text>
                </Pressable>
              ) : (
                <Text className={`mt-1 text-sm ${nw.textMuted}`}>
                  No symptom preset linked yet. Start or configure an episode
                  from the episode start screen.
                </Text>
              )}
            </View>
          ) : null}
        </View>

        <View>
          <Text
            className={`text-lg font-semibold ${nw.textInk}`}
            accessibilityRole="header"
            maxFontSizeMultiplier={2}
          >
            Recent episodes
          </Text>
          {recentError ? (
            <Text
              className={`mt-2 text-sm ${nw.textError}`}
              accessibilityRole="alert"
              maxFontSizeMultiplier={2}
            >
              {recentError}
            </Text>
          ) : null}
          {!loading && !recentError && recent.length === 0 ? (
            <Text className={`mt-2 text-sm ${nw.textMuted}`}>
              No ended episodes in your history yet.
            </Text>
          ) : null}
          {!loading && recent.length > 0 ? (
            <View className="mt-3 gap-3" accessibilityRole="list">
              {recent.map((ep) => (
                <View
                  key={ep.id}
                  className={`rounded-xl border border-app-border bg-app-surface p-4 dark:border-app-border-dark dark:bg-app-surface-dark`}
                  accessibilityRole="none"
                >
                  <Text
                    className="text-xs font-semibold uppercase text-app-muted"
                    maxFontSizeMultiplier={2}
                  >
                    Ended
                  </Text>
                  <Text
                    className={`mt-1 text-base font-semibold ${nw.textInk}`}
                    maxFontSizeMultiplier={2}
                  >
                    {episodeSummaryLine(ep)}
                  </Text>
                  <Text className={`mt-2 text-sm ${nw.textMuted}`}>
                    Started {formatInstant(ep.started_at)}
                  </Text>
                  <Text className={`text-sm ${nw.textMuted}`}>
                    Ended {ep.ended_at ? formatInstant(ep.ended_at) : '—'}
                  </Text>
                </View>
              ))}
            </View>
          ) : null}
        </View>
      </ScrollView>
    </ScreenShell>
  );
}
