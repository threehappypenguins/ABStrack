export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      access_log: {
        Row: {
          action: string
          actor_role: string
          actor_user_id: string | null
          id: string
          ip_hash: string | null
          occurred_at: string
          patient_user_id: string | null
          request_id: string | null
          resource_id: string | null
          resource_type: string
        }
        Insert: {
          action: string
          actor_role: string
          actor_user_id?: string | null
          id?: string
          ip_hash?: string | null
          occurred_at?: string
          patient_user_id?: string | null
          request_id?: string | null
          resource_id?: string | null
          resource_type: string
        }
        Update: {
          action?: string
          actor_role?: string
          actor_user_id?: string | null
          id?: string
          ip_hash?: string | null
          occurred_at?: string
          patient_user_id?: string | null
          request_id?: string | null
          resource_id?: string | null
          resource_type?: string
        }
        Relationships: []
      }
      caretaker_access: {
        Row: {
          caretaker_user_id: string
          created_at: string
          id: string
          patient_user_id: string
          revoked_at: string | null
        }
        Insert: {
          caretaker_user_id: string
          created_at?: string
          id?: string
          patient_user_id: string
          revoked_at?: string | null
        }
        Update: {
          caretaker_user_id?: string
          created_at?: string
          id?: string
          patient_user_id?: string
          revoked_at?: string | null
        }
        Relationships: []
      }
      caretaker_invites: {
        Row: {
          consumed_at: string | null
          consumed_caretaker_user_id: string | null
          created_at: string
          expires_at: string
          id: string
          invitee_email_normalized: string
          last_invite_sent_at: string | null
          patient_user_id: string
        }
        Insert: {
          consumed_at?: string | null
          consumed_caretaker_user_id?: string | null
          created_at?: string
          expires_at: string
          id?: string
          invitee_email_normalized: string
          last_invite_sent_at?: string | null
          patient_user_id: string
        }
        Update: {
          consumed_at?: string | null
          consumed_caretaker_user_id?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          invitee_email_normalized?: string
          last_invite_sent_at?: string | null
          patient_user_id?: string
        }
        Relationships: []
      }
      episode_media: {
        Row: {
          created_at: string
          duration_seconds: number | null
          episode_id: string
          episode_symptom_id: string | null
          id: string
          media_type: string
          storage_object_key: string
          thumbnail_storage_key: string | null
          updated_at: string
          upload_completed_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          duration_seconds?: number | null
          episode_id: string
          episode_symptom_id?: string | null
          id?: string
          media_type: string
          storage_object_key: string
          thumbnail_storage_key?: string | null
          updated_at?: string
          upload_completed_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          duration_seconds?: number | null
          episode_id?: string
          episode_symptom_id?: string | null
          id?: string
          media_type?: string
          storage_object_key?: string
          thumbnail_storage_key?: string | null
          updated_at?: string
          upload_completed_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "episode_media_episode_fk"
            columns: ["user_id", "episode_id"]
            isOneToOne: false
            referencedRelation: "episodes"
            referencedColumns: ["user_id", "id"]
          },
          {
            foreignKeyName: "episode_media_symptom_step_fk"
            columns: ["episode_id", "episode_symptom_id"]
            isOneToOne: false
            referencedRelation: "episode_symptoms"
            referencedColumns: ["episode_id", "id"]
          },
        ]
      }
      episode_symptoms: {
        Row: {
          created_at: string
          episode_id: string | null
          id: string
          preset_symptom_id: string | null
          response_boolean: boolean | null
          response_severity: number | null
          response_text: string | null
          response_type: string
          sort_order: number
          symptom_name: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          episode_id?: string | null
          id?: string
          preset_symptom_id?: string | null
          response_boolean?: boolean | null
          response_severity?: number | null
          response_text?: string | null
          response_type: string
          sort_order?: number
          symptom_name: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          episode_id?: string | null
          id?: string
          preset_symptom_id?: string | null
          response_boolean?: boolean | null
          response_severity?: number | null
          response_text?: string | null
          response_type?: string
          sort_order?: number
          symptom_name?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "episode_symptoms_episode_fk"
            columns: ["user_id", "episode_id"]
            isOneToOne: false
            referencedRelation: "episodes"
            referencedColumns: ["user_id", "id"]
          },
          {
            foreignKeyName: "episode_symptoms_preset_symptom_id_fkey"
            columns: ["preset_symptom_id"]
            isOneToOne: false
            referencedRelation: "preset_symptoms"
            referencedColumns: ["id"]
          },
        ]
      }
      episode_templates: {
        Row: {
          created_at: string
          health_marker_preset_id: string
          id: string
          name: string
          symptom_preset_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          health_marker_preset_id: string
          id?: string
          name: string
          symptom_preset_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          health_marker_preset_id?: string
          id?: string
          name?: string
          symptom_preset_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "episode_templates_health_marker_preset_id_fk"
            columns: ["health_marker_preset_id"]
            isOneToOne: false
            referencedRelation: "health_marker_presets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "episode_templates_symptom_preset_id_fk"
            columns: ["symptom_preset_id"]
            isOneToOne: false
            referencedRelation: "symptom_presets"
            referencedColumns: ["id"]
          },
        ]
      }
      episodes: {
        Row: {
          additional_notes: string | null
          created_at: string
          ended_at: string | null
          episode_label: string | null
          episode_type: string
          health_marker_preset_id: string | null
          id: string
          note: string | null
          post_marker_step_completed_at: string | null
          started_at: string
          symptom_preset_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          additional_notes?: string | null
          created_at?: string
          ended_at?: string | null
          episode_label?: string | null
          episode_type?: string
          health_marker_preset_id?: string | null
          id?: string
          note?: string | null
          post_marker_step_completed_at?: string | null
          started_at: string
          symptom_preset_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          additional_notes?: string | null
          created_at?: string
          ended_at?: string | null
          episode_label?: string | null
          episode_type?: string
          health_marker_preset_id?: string | null
          id?: string
          note?: string | null
          post_marker_step_completed_at?: string | null
          started_at?: string
          symptom_preset_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "episodes_health_marker_preset_id_fk"
            columns: ["health_marker_preset_id"]
            isOneToOne: false
            referencedRelation: "health_marker_presets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "episodes_symptom_preset_id_fk"
            columns: ["symptom_preset_id"]
            isOneToOne: false
            referencedRelation: "symptom_presets"
            referencedColumns: ["id"]
          },
        ]
      }
      food_diary_entries: {
        Row: {
          created_at: string
          episode_id: string | null
          food_note: string
          id: string
          logged_at: string
          meal_tag: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          episode_id?: string | null
          food_note: string
          id?: string
          logged_at: string
          meal_tag: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          episode_id?: string | null
          food_note?: string
          id?: string
          logged_at?: string
          meal_tag?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "food_diary_episode_id_fk"
            columns: ["episode_id"]
            isOneToOne: false
            referencedRelation: "episodes"
            referencedColumns: ["id"]
          },
        ]
      }
      health_marker_presets: {
        Row: {
          created_at: string
          id: string
          name: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      health_markers: {
        Row: {
          created_at: string
          custom_name: string | null
          custom_name_key: string | null
          custom_unit: string | null
          custom_unit_key: string | null
          diastolic_numeric: number | null
          episode_id: string | null
          id: string
          marker_kind: string
          notes: string | null
          preset_health_marker_id: string | null
          recorded_at: string
          systolic_numeric: number | null
          updated_at: string
          user_id: string
          value_numeric: number | null
        }
        Insert: {
          created_at?: string
          custom_name?: string | null
          custom_name_key?: string | null
          custom_unit?: string | null
          custom_unit_key?: string | null
          diastolic_numeric?: number | null
          episode_id?: string | null
          id?: string
          marker_kind: string
          notes?: string | null
          preset_health_marker_id?: string | null
          recorded_at: string
          systolic_numeric?: number | null
          updated_at?: string
          user_id: string
          value_numeric?: number | null
        }
        Update: {
          created_at?: string
          custom_name?: string | null
          custom_name_key?: string | null
          custom_unit?: string | null
          custom_unit_key?: string | null
          diastolic_numeric?: number | null
          episode_id?: string | null
          id?: string
          marker_kind?: string
          notes?: string | null
          preset_health_marker_id?: string | null
          recorded_at?: string
          systolic_numeric?: number | null
          updated_at?: string
          user_id?: string
          value_numeric?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "health_markers_episode_fk"
            columns: ["user_id", "episode_id"]
            isOneToOne: false
            referencedRelation: "episodes"
            referencedColumns: ["user_id", "id"]
          },
          {
            foreignKeyName: "health_markers_preset_health_marker_id_fkey"
            columns: ["preset_health_marker_id"]
            isOneToOne: false
            referencedRelation: "preset_health_markers"
            referencedColumns: ["id"]
          },
        ]
      }
      practitioner_access: {
        Row: {
          created_at: string
          id: string
          patient_user_id: string
          practitioner_user_id: string
          revoked_at: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          patient_user_id: string
          practitioner_user_id: string
          revoked_at?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          patient_user_id?: string
          practitioner_user_id?: string
          revoked_at?: string | null
        }
        Relationships: []
      }
      practitioner_invite_send_throttle: {
        Row: {
          invitee_email_normalized: string
          last_invite_sent_at: string
          patient_user_id: string
        }
        Insert: {
          invitee_email_normalized: string
          last_invite_sent_at: string
          patient_user_id: string
        }
        Update: {
          invitee_email_normalized?: string
          last_invite_sent_at?: string
          patient_user_id?: string
        }
        Relationships: []
      }
      practitioner_invites: {
        Row: {
          consumed_at: string | null
          consumed_practitioner_user_id: string | null
          created_at: string
          expires_at: string
          id: string
          invitee_email_normalized: string
          last_invite_sent_at: string | null
          patient_user_id: string
        }
        Insert: {
          consumed_at?: string | null
          consumed_practitioner_user_id?: string | null
          created_at?: string
          expires_at: string
          id?: string
          invitee_email_normalized: string
          last_invite_sent_at?: string | null
          patient_user_id: string
        }
        Update: {
          consumed_at?: string | null
          consumed_practitioner_user_id?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          invitee_email_normalized?: string
          last_invite_sent_at?: string | null
          patient_user_id?: string
        }
        Relationships: []
      }
      practitioner_observation_notes: {
        Row: {
          body: string
          created_at: string
          episode_id: string | null
          id: string
          patient_user_id: string
          practitioner_user_id: string
          updated_at: string
        }
        Insert: {
          body: string
          created_at?: string
          episode_id?: string | null
          id?: string
          patient_user_id: string
          practitioner_user_id: string
          updated_at?: string
        }
        Update: {
          body?: string
          created_at?: string
          episode_id?: string | null
          id?: string
          patient_user_id?: string
          practitioner_user_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "practitioner_observation_notes_episode_owner_fk"
            columns: ["patient_user_id", "episode_id"]
            isOneToOne: false
            referencedRelation: "episodes"
            referencedColumns: ["user_id", "id"]
          },
        ]
      }
      preset_health_markers: {
        Row: {
          created_at: string
          custom_name: string | null
          custom_unit: string | null
          id: string
          marker_kind: string
          preset_id: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          custom_name?: string | null
          custom_unit?: string | null
          id?: string
          marker_kind: string
          preset_id: string
          sort_order: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          custom_name?: string | null
          custom_unit?: string | null
          id?: string
          marker_kind?: string
          preset_id?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "preset_health_markers_preset_id_fkey"
            columns: ["preset_id"]
            isOneToOne: false
            referencedRelation: "health_marker_presets"
            referencedColumns: ["id"]
          },
        ]
      }
      preset_symptoms: {
        Row: {
          created_at: string
          id: string
          preset_id: string
          prompt_instruction: string | null
          response_type: string
          sort_order: number
          symptom_name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          preset_id: string
          prompt_instruction?: string | null
          response_type: string
          sort_order: number
          symptom_name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          preset_id?: string
          prompt_instruction?: string | null
          response_type?: string
          sort_order?: number
          symptom_name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "preset_symptoms_preset_id_fkey"
            columns: ["preset_id"]
            isOneToOne: false
            referencedRelation: "symptom_presets"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          app_role: string
          created_at: string
          display_name: string | null
          id: string
          updated_at: string
        }
        Insert: {
          app_role: string
          created_at?: string
          display_name?: string | null
          id: string
          updated_at?: string
        }
        Update: {
          app_role?: string
          created_at?: string
          display_name?: string | null
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      symptom_presets: {
        Row: {
          created_at: string
          id: string
          name: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      episode_media_storage_can_select: {
        Args: { p_object_name: string }
        Returns: boolean
      }
      episode_media_storage_can_write: {
        Args: { p_object_name: string }
        Returns: boolean
      }
      episode_media_storage_path_user_id: {
        Args: { p_object_name: string }
        Returns: string
      }
      list_practitioner_auth_emails_for_patient_grants: {
        Args: { p_patient_user_id: string; p_practitioner_user_ids: string[] }
        Returns: {
          email: string
          practitioner_user_id: string
        }[]
      }
      profiles_trusted_session_for_app_role: { Args: never; Returns: boolean }
      reorder_preset_health_markers: {
        Args: { p_ordered_ids: string[]; p_preset_id: string }
        Returns: undefined
      }
      reorder_preset_symptoms: {
        Args: { p_ordered_ids: string[]; p_preset_id: string }
        Returns: undefined
      }
      resolve_auth_user_id_by_normalized_email: {
        Args: { p_normalized: string }
        Returns: string
      }
      stamp_caretaker_invite_pre_send: {
        Args: {
          p_invite_id: string
          p_stamp: string
          p_throttle_cutoff: string
        }
        Returns: string[]
      }
      stamp_practitioner_invite_pre_send: {
        Args: {
          p_invite_id: string
          p_stamp: string
          p_throttle_cutoff: string
        }
        Returns: string[]
      }
      stamp_practitioner_invite_send_throttle: {
        Args: {
          p_invitee_email_normalized: string
          p_patient_user_id: string
          p_stamp: string
          p_throttle_cutoff: string
        }
        Returns: string[]
      }
      user_has_practitioner_access: {
        Args: { p_patient_user_id: string }
        Returns: boolean
      }
      user_is_caretaker_for_patient: {
        Args: { p_patient_user_id: string }
        Returns: boolean
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
