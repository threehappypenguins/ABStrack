import type { Database } from './database.types.js';

type GeneratedShareChartSnapshotArgs =
  Database['public']['Functions']['share_chart_snapshot']['Args'];

/**
 * PostgREST / RPC args for `public.share_chart_snapshot` after migration
 * `20260524140000_chart_snapshots.sql` (`p_chart_timezone`).
 *
 * Until `supabase gen types typescript --linked` includes this arg on the generated
 * `Database` type, callers should build payloads as this type and pass them through
 * {@link asGeneratedShareChartSnapshotRpcArgs} at the `client.rpc` boundary.
 */
export type ShareChartSnapshotRpcArgs = GeneratedShareChartSnapshotArgs & {
  p_chart_timezone: string;
};

type GeneratedChartSnapshotsRow =
  Database['public']['Tables']['chart_snapshots']['Row'];

/**
 * `public.chart_snapshots` row including `chart_timezone` (migration `20260524140000`).
 *
 * Use for `.from('chart_snapshots').select(...)` results until generated types catch up.
 */
export type ChartSnapshotsRowDb = GeneratedChartSnapshotsRow & {
  chart_timezone: string | null;
};

/** Column list for patient unseen snapshot queries (includes `chart_timezone`). */
export const CHART_SNAPSHOT_LIST_SELECT =
  'id, patient_user_id, practitioner_user_id, series_definition, date_from, date_to, bucket, practitioner_note, chart_timezone, created_at, seen_by_patient_at' as const;

/**
 * Same columns as {@link CHART_SNAPSHOT_LIST_SELECT}, widened for `.select()` until generated
 * types include `chart_snapshots.chart_timezone` (avoids `SelectQueryError` at compile time).
 */
export const CHART_SNAPSHOT_LIST_SELECT_FOR_QUERY: string =
  CHART_SNAPSHOT_LIST_SELECT;

/**
 * Narrows {@link ShareChartSnapshotRpcArgs} for `AbstrackSupabaseClient.rpc` until
 * `database.types.ts` is regenerated.
 *
 * @param args - Full RPC payload including `p_chart_timezone`.
 * @returns Value typed for the current generated `share_chart_snapshot` Args.
 */
export function asGeneratedShareChartSnapshotRpcArgs(
  args: ShareChartSnapshotRpcArgs,
): GeneratedShareChartSnapshotArgs {
  return args as GeneratedShareChartSnapshotArgs;
}
