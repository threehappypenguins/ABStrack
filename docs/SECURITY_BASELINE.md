# ABStrack Security Baseline

This document summarizes the repository security posture, points to implementation artifacts, and distinguishes controls that are implemented now versus planned work.

## Scope and Status

- Scope: repository and Supabase architecture baseline for user, caretaker, and practitioner data access.
- Current phase: Week 3 complete.
- Status model used in this document:
  - Implemented: present in migrations and/or app code in this repository.
  - Planned: defined in PRD/roadmap but explicitly scheduled for a later week.

## Security Posture at a Glance

| Control                                                               | Current Status                                      | Where Defined / Implemented                                                                                                                                                                                                                           |
| --------------------------------------------------------------------- | --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TLS for client to Supabase traffic                                    | Implemented                                         | [PRD: Architecture](PRD.md#architecture-overview) + [Security](PRD.md#security-privacy-and-compliance), Supabase platform/API model                                                                                                                   |
| RLS for PHI tables                                                    | Implemented                                         | `supabase/migrations/20260327130000_rls_policies.sql`                                                                                                                                                                                                 |
| Grant-table authorization (`practitioner_access`, `caretaker_access`) | Implemented                                         | `supabase/migrations/20260327120000_abstrack_core_schema.sql`, `supabase/migrations/20260327130000_rls_policies.sql`                                                                                                                                  |
| Append-only `access_log` with trusted insert path                     | Implemented                                         | `supabase/migrations/20260327120000_abstrack_core_schema.sql`, `supabase/migrations/20260327130000_rls_policies.sql`                                                                                                                                  |
| Auth (email/password, persistent session, password reset/change)      | Implemented                                         | `packages/supabase/src/lib/auth.ts`, app auth screens/providers                                                                                                                                                                                       |
| Practitioner MFA enforcement (fail-closed)                            | Implemented (RLS + helpers; UI uses claim contract) | [PRD: Authentication](PRD.md#1-authentication); [AUTH_CLAIM_CONTRACT.md](AUTH_CLAIM_CONTRACT.md); `supabase/migrations/20260416120000_practitioner_mfa_assurance_rls.sql`; `packages/supabase/src/lib/session-claims.ts`; practitioner `AuthProvider` |
| Media bucket privacy + `storage.objects` RLS                          | Implemented                                         | `supabase/migrations/20260328100000_episode_media_storage_bucket.sql`                                                                                                                                                                                 |
| Media access via signed URLs                                          | Planned for app flow (Week 7)                       | [PRD §10](PRD.md#10-video--photo-capture) + [roadmap Week 7](ROADMAP.md#week-7-april-27---may-3----media-capture-and-offline-sync)                                                                                                                    |
| Data model: plaintext PHI under RLS (no app-layer E2E encryption)     | Implemented as design baseline                      | [PRD: Security](PRD.md#security-privacy-and-compliance) + [data model](PRD.md#data-model-plaintext-phi-in-supabase-under-rls); schema comments in core migration                                                                                      |
| PowerSync + SQLCipher offline protections                             | Planned (Week 7)                                    | [PRD: Architecture](PRD.md#architecture-overview)/[Security](PRD.md#security-privacy-and-compliance) and [roadmap Week 7](ROADMAP.md#week-7-april-27---may-3----media-capture-and-offline-sync)                                                       |

## Control Details

### 1) TLS: all client <-> Supabase traffic over HTTPS

- Intent: all API/auth/storage traffic from clients to Supabase is over HTTPS/TLS.
- PRD references:
  - [PRD: Architecture overview](PRD.md#architecture-overview) (web apps query Supabase over TLS)
  - [PRD: Security controls summary](PRD.md#security-controls-summary-technical-safeguards) and [technical safeguard baseline](PRD.md#technical-safeguard-baseline-hipaa-164312oriented) (TLS for API/storage)
- Platform alignment (Supabase docs): API and Storage endpoints are HTTPS; production guidance requires HTTPS/TLS.
- Status: Implemented baseline assumption for all deployed environments.

### 2) Row-Level Security (RLS): PHI tables and policy intent

- Intent: PHI access is database-enforced, not UI-enforced.
- Implementation:
  - RLS enabled for `profiles`, preset tables, `episodes`, `episode_symptoms`, `health_markers`, `food_diary_entries`, `episode_media`, grant tables, and `access_log` in `supabase/migrations/20260327130000_rls_policies.sql`.
  - Policy pattern (PHI tables):
    - Patient owner: read/write own rows.
    - Caretaker: read/write when active `caretaker_access` grant exists.
    - Practitioner: read-only when active `practitioner_access` grant exists (MFA fail-closed hardening scheduled Week 5).
  - Ownership hardening:
    - `enforce_phi_row_user_id_immutable` trigger blocks changing `user_id` on PHI rows except trusted paths.
- PRD references:
  - [PRD: Security — Authorized access](PRD.md#authorized-access-practitioners-and-caretakers-no-dek-sharing) + explicit RLS requirements table.
  - [PRD: Security controls summary](PRD.md#security-controls-summary-technical-safeguards) and [technical safeguard baseline](PRD.md#technical-safeguard-baseline-hipaa-164312oriented).
- Status: Implemented.
- Automated checks: Vitest integration suite [`packages/supabase/src/preset-flows.integration.spec.ts`](../packages/supabase/src/preset-flows.integration.spec.ts) validates owner vs other-user access for **symptom** and **health marker** presets against Supabase Cloud when `SUPABASE_SECRET_KEY` is configured (see [SUPABASE_CLOUD_DEVELOPER.md — Preset RLS integration tests](SUPABASE_CLOUD_DEVELOPER.md#preset-rls-integration-tests)). It does not exercise **caretaker** or **practitioner** grant paths (those require grant fixtures and are a coverage gap until covered elsewhere).

### 3) Grant tables: authorized sharing model

- Intent: patient-initiated sharing is encoded as grant rows, then enforced by RLS.
- Tables:
  - `practitioner_access` (patient <-> practitioner authorization)
  - `caretaker_access` (patient <-> caretaker authorization)
- Implementation:
  - Core schema includes both grant tables in `supabase/migrations/20260327120000_abstrack_core_schema.sql`.
  - Role-validation triggers enforce proper profile roles on grant endpoints in `supabase/migrations/20260327130000_rls_policies.sql`.
  - Grant-table policies:
    - Patients manage their own grants.
    - Practitioners/caretakers can select rows relevant to themselves.
  - Helper functions `user_has_practitioner_access` and `user_is_caretaker_for_patient` are used across PHI and storage policies.
- PRD references:
  - [PRD: Users & Roles](PRD.md#users--roles), [Authorized access](PRD.md#authorized-access-practitioners-and-caretakers-no-dek-sharing), and RLS requirements table.
- Status: Implemented. Practitioner MFA assurance is enforced in SQL on the grant path; client routing uses `profiles.app_role` plus JWT `aal` per [AUTH_CLAIM_CONTRACT.md](AUTH_CLAIM_CONTRACT.md) (no ambiguous fallbacks).

### 4) `access_log`: append-only audit logging with trusted insert path

- Intent: audit records are append-only and cannot be forged by normal clients.
- Implementation:
  - Table shape is defined in `supabase/migrations/20260327120000_abstrack_core_schema.sql` with explicit no-PHI intent.
  - Privilege revocation and trusted insert role setup in `supabase/migrations/20260327130000_rls_policies.sql`:
    - `authenticated` has `SELECT` only.
    - `service_role` has `INSERT` + `SELECT` for trusted paths.
  - Trigger `access_log_prevent_update_or_delete` blocks mutation/deletion (except FK nulling edge case).
  - RLS policies include explicit deny-update/deny-delete for authenticated users and service-role insert/select policies.
- PRD references:
  - [PRD: Access logging](PRD.md#access-logging-access_log) and [compliance-oriented checklist](PRD.md#compliance-oriented-engineering-checklist-non-exhaustive).
- Status: Implemented.

### 5) Authentication baseline (Week 3)

- Intent: patient auth/session lifecycle is built on Supabase Auth, with no app-layer data re-encryption model.
- Implemented now:
  - Email/password sign-up and login wrappers in `packages/supabase/src/lib/auth.ts`.
  - Persistent session handling via Supabase session APIs and auth-state listeners:
    - `apps/mobile/src/app/App.tsx`
    - `apps/web/src/lib/auth-provider.tsx`
  - Optional patient re-auth-on-open preference in mobile:
    - `apps/mobile/src/app/reauth-preference.ts`
    - `apps/mobile/src/app/screens/SettingsScreen.tsx`
  - Password reset and password update flows:
    - `apps/mobile/src/app/screens/ForgotPasswordScreen.tsx`
    - `apps/mobile/src/app/screens/UpdatePasswordScreen.tsx`
    - `apps/web/src/app/forgot-password/page.tsx`
    - `apps/web/src/app/update-password/page.tsx`
  - Week 3 health check wiring (`healthCheckProfilesLimit1`) to validate auth/session/env/RLS path:
    - `apps/mobile/src/app/screens/HomeScreen.tsx`
    - `apps/web/src/app/dashboard/page.tsx`
- Planned:
  - Additional practitioner app routes gated on MFA readiness (see [ROADMAP](ROADMAP.md)).
- PRD references:
  - [PRD §1: Authentication](PRD.md#1-authentication).
  - [PRD: Practitioner TOTP enforcement (fail-closed)](PRD.md#two-factor-authentication-totp).
- Status: Week 3 auth baseline implemented; practitioner MFA enforcement and claim contract documented in [AUTH_CLAIM_CONTRACT.md](AUTH_CLAIM_CONTRACT.md).

### 6) Media storage security

- Intent: media confidentiality is provided by private bucket + RLS + TLS + platform encryption at rest, not client-managed DEKs.
- Implemented now:
  - Private bucket creation (`episode-media`) in `supabase/migrations/20260328100000_episode_media_storage_bucket.sql`.
  - `storage.objects` RLS policies for select/insert/update/delete scoped to owner/caretaker/practitioner access helpers in the same migration.
  - Path-derived owner checks (`{user_id}/...`) via SQL helper functions in the same migration.
- Planned:
  - End-user signed URL playback/download flow completion in app UX and offline queue workflow (Week 7).
- PRD references:
  - [PRD: Media storage security](PRD.md#media-storage-security).
  - [PRD §10: Video & Photo Capture](PRD.md#10-video--photo-capture) (storage and signed URLs).
- Status: bucket + policy baseline implemented; Week 7 app flows planned.

### 7) Data model posture (plaintext PHI under RLS)

- Intent: PHI is stored as normal Postgres columns and protected by RLS/authorization controls; no application-layer end-to-end field encryption.
- Implementation:
  - Explicitly documented in schema migration header comments and PRD.
  - Enforced as architecture baseline across schema and access policy design.
- PRD references:
  - [PRD: Data model — plaintext PHI in Supabase under RLS](PRD.md#data-model-plaintext-phi-in-supabase-under-rls).
  - [PRD: Security controls summary](PRD.md#security-controls-summary-technical-safeguards) and [§10 media notes](PRD.md#10-video--photo-capture).
- Status: Implemented baseline.

## Implemented vs Planned Summary

Implemented now:

- TLS transport baseline for Supabase API/auth/storage usage.
- RLS on PHI and grant/audit tables.
- Grant-table authorization model.
- Append-only `access_log` protections.
- Email/password auth, persistent session behavior, reset/update password flows.
- Week 3 health-check wiring using `healthCheckProfilesLimit1`.
- Private media bucket and `storage.objects` RLS policies.
- Plaintext PHI data model under RLS.

Planned (not yet complete):

- Practitioner app navigation to patient-data routes behind explicit MFA-ready UI checks (beyond security setup page).
- PowerSync + SQLCipher offline model implementation (Week 7).
- Signed URL media playback/download flow completion in product UX and offline queue flow (Week 7).

## Traceability Index

Core implementation artifacts:

- `supabase/migrations/20260327120000_abstrack_core_schema.sql`
- `supabase/migrations/20260327130000_rls_policies.sql`
- `supabase/migrations/20260328100000_episode_media_storage_bucket.sql`
- `packages/supabase/src/lib/auth.ts`
- `apps/mobile/src/app/App.tsx`
- `apps/mobile/src/app/screens/HomeScreen.tsx`
- `apps/mobile/src/app/screens/SettingsScreen.tsx`
- `apps/mobile/src/app/screens/ForgotPasswordScreen.tsx`
- `apps/mobile/src/app/screens/UpdatePasswordScreen.tsx`
- `apps/web/src/lib/auth-provider.tsx`
- `apps/web/src/app/dashboard/page.tsx`

Primary design references:

- [docs/PRD.md](PRD.md) (Security, Authentication, and Media sections)
- [docs/AUTH_CLAIM_CONTRACT.md](AUTH_CLAIM_CONTRACT.md) (JWT + `profiles.app_role` contract)
- [docs/ROADMAP.md](ROADMAP.md) (Week 3, Week 5, Week 7)
