import type { Database, Json } from './database.types.js';

/**
 * `share_chart_snapshot` / `mark_chart_snapshot_seen` RPC shapes until
 * `database.types.ts` is regenerated after `20260524130000_chart_snapshots.sql`.
 */
export type ChartSnapshotsRpcDatabase = Database & {
  public: Database['public'] & {
    Functions: Database['public']['Functions'] & {
      share_chart_snapshot: {
        Args: {
          p_patient_user_id: string;
          p_series_definition: Json;
          p_date_from: string;
          p_date_to: string;
          p_bucket: string;
          p_practitioner_note: string | null;
        };
        Returns: string;
      };
      mark_chart_snapshot_seen: {
        Args: { p_snapshot_id: string };
        Returns: boolean;
      };
    };
  };
};
