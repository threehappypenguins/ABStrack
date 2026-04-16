# Auth claim contract (ABStrack)

This document defines **which identity fields** ABStrack uses for **routing**, **UI gating**, and how they relate to **database enforcement** (RLS and Edge Functions). It exists so client, server, and policy layers stay aligned and **do not rely on ambiguous JWT hook behavior** for security guarantees.

## Two different “roles”

| Field                 | Where it lives                                                          | Purpose                                                                                                                                    |
| --------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| **Application role**  | `public.profiles.app_role` (`patient` \| `caretaker` \| `practitioner`) | Product routing: which app and which flows apply. **Source of truth is Postgres**, selected under RLS as the authenticated user’s own row. |
| **Supabase API role** | JWT claim `role` (`authenticated` \| `anon` \| `service_role`)          | Supabase Auth / PostgREST role. **Not** the same as `profiles.app_role`. Do **not** use JWT `role` for application routing.                |

Self-service signup can only create `patient` or `caretaker` profiles; `practitioner` requires a trusted path (see migrations on `profiles_enforce_app_role`).

## JWT claims used by ABStrack

Access tokens are standard Supabase Auth JWTs. The following claims are **intentionally** used in code and/or SQL:

| Claim  | Use                                                                                                                                                                                                                                      |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sub`  | Auth user id (matches `profiles.id`).                                                                                                                                                                                                    |
| `role` | Supabase API role only (see above).                                                                                                                                                                                                      |
| `aal`  | **Authenticator assurance level.** For practitioner access to patient data, RLS requires `aal` **exactly** `'aal2'` inside `user_has_practitioner_access` (see `supabase/migrations/20260416120000_practitioner_mfa_assurance_rls.sql`). |
| `amr`  | Optional diagnostic context (Supabase); not used for authorization logic in-repo today.                                                                                                                                                  |

### MFA assurance (practitioner)

- **Client / UI:** `parseAbstrackAccessTokenClaims` + `hasMfaAssuranceAal2` in `@abstrack/supabase` treat **only** `aal === 'aal2'` as MFA-ready. Missing `aal` or any other value is **false** (no fail-open default to password-only).
- **Database:** Practitioner grant path enforces the same predicate in SQL; if a grant exists but `aal` is not `aal2`, the function **raises** `42501` (fail-closed), not a silent empty result.
- **Edge Function:** `practitioner-mfa-auth-audit` validates session via Auth API and inspects JWT `aal` for auditing; RLS remains the primary control.

## What we do not rely on for authorization

- **Custom access-token hooks** that inject `app_role` or MFA claims: even if present, **enforcement** does not depend on hooks alone, because hooks can fail in ways that omit claims (PRD: no hook-only reliance for practitioner MFA).
- **JWT `role` = `authenticated`** as proof of application role: it only means “logged in to Supabase.”

## Shared helpers

| Export                           | Package              | Role                                                                                                     |
| -------------------------------- | -------------------- | -------------------------------------------------------------------------------------------------------- |
| `parseAbstrackAccessTokenClaims` | `@abstrack/supabase` | Decode JWT payload for `aal` / `role` (after Supabase has already issued the session).                   |
| `resolvePractitionerAppGate`     | `@abstrack/supabase` | Combine session + `profiles` row + claims into a single discriminated gate for the practitioner web app. |
| `fetchProfileByUserId`           | `@abstrack/supabase` | Load `profiles.app_role` for routing.                                                                    |

## Related documents

- [PRD: Two-factor authentication (TOTP)](PRD.md#two-factor-authentication-totp) — practitioner MFA expectations.
- [SECURITY_BASELINE.md](SECURITY_BASELINE.md) — control inventory and traceability.
