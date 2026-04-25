# User story: Episode flows + standalone health and food logging

**Status:** Draft (product intent; schedule on [ROADMAP.md](../ROADMAP.md) — **Week 5:** migrations (`health_marker_preset_id` + episode templates table), template settings UI, **I'm having an episode** + template picker; **Week 6 (shipped):** full symptom + marker + food-in-flow prompt, standalone health markers, standalone food diary, consolidated management; **Week 6+ (in progress):** [multiple guided passes](#multiple-guided-passes-while-the-episode-is-open) and the [data model](#data-model-for-repeat-observations) — see **Week 6** unchecked items on the roadmap.  
**Related PRD:** [PRD.md](../PRD.md) — §3 Health Marker Presets, §4 Episode Logging, §5 General Wellness Logging

This document expands the **user-facing flows** for:

1. Starting an **episode** when the user may be **cognitively impaired** — the UI must not dump many choices on them at once ([PRD](../PRD.md) impaired-user requirements).
2. **Asymptomatic** use: the user wants to **track health markers** using a preset, with **no** symptom episode.
3. Standalone **food diary** logging outside episode prompts.

The PRD states the **order** of prompts (symptoms first, then health markers). This story adds **how** pairing is chosen without overwhelming the user at episode start.

## Product scope guardrails

- Symptoms (including nausea/vomiting and related episode symptoms) are captured through the **episode flow**, not a standalone symptom path.
- Standalone logging in this scope is limited to:
  - health marker entries
  - food diary entries
- Generic "How are you feeling" mood/wellness capture is out of scope for these flows.

---

## Accessibility intent: one clear choice, then a linear flow

Episode templates exist so that **configuration complexity** (symptom list + health marker list + how they pair) lives in **settings**, not at the moment someone taps **“I'm having an episode.”**

At episode start, the experience is: **pick what kind of episode this is** using **one** large, high-contrast choice per row (e.g. **“ABS Episode”**, **“CVS Episode”**) — each label is an **episode template** that already points at the right symptom preset **and** health marker preset. After that single decision, the app runs **one linear prompt flow** (symptoms in order, then markers in order, then food and **Episode details** as the product defines). There is **no** separate “pick symptom preset” and “pick health marker preset” step during an episode; pairing is **only** done ahead of time when editing templates in settings.

### Multiple guided passes while the episode is open

While `episodes.ended_at` is still **null**, Eric can run **more than one full pass** of the **same** guided sequence, and the **only** primary path to do that is **Resume / Continue this episode** (not a separate “log an update” route or new home-level shortcut for the same work). One **pass** means: run through symptom prompts → health marker prompts → in-flow food step (if included) → **Episode details** (episode type, notes, etc. per [PRD](../PRD.md)), then **Save and continue**. That action **completes the current pass** and returns Eric to the **start of the next pass** (symptom prompts again, then markers, then food, and so on), so **symptom severities, marker values, and episode-tied food** can all change as the episode progresses. That supports practitioners who need to see **how things moved over time** during one flare.

There is **no** required `round` or `sequence` column in the data model for ordering: each saved value is a **separate row** in the same tables as today, with **uniqueness relaxed** so more than one row can exist for the same `(episode, preset line)` where needed; the UI orders history by **timestamps** (and a stable tie-breaker such as `id`).

### Data model for repeat observations

- **One row per observation** in the existing tables (`episode_symptoms`, `health_markers` for episode-bound lines, and `food_diary_entries` when `episode_id` is set), not destructive overwrites of a single “current” row per line.
- **Order** of what happened when: by `recorded_at` / `logged_at` (and `id` if two events share a timestamp).
- **After the episode is ended** (`ended_at` set), **new** episode-tied structured data (symptoms, markers, food with that `episode_id`) follows the product rule used in the app (typically: **no** new in-episode appends; **standalone** food and health markers on home remain available with `episode_id` null for “not on this episode” context).

---

## Persona — Eric

**Eric** lives with **ABS** and also has **an unknown vomiting condition**. He can feel the difference between:

- An **ABS-related** flare (where BAC and ABS-specific markers matter to his workflow), and
- A **CVS-like** bout — vertigo, nausea, vomiting **without** it being an ABS episode for him.

So Eric needs **more than one named episode type** at start — not more complexity on one screen. He should see a **short list of big buttons** (or an equally accessible control), e.g. **“ABS Episode”** and **“CVS Episode”**, each backed by its own episode template (different symptom lines, different marker lines, or both). One tap → into the combined flow.

Eric also wants to log glucose or other markers on a **good day** without starting any episode — that is **standalone health marker logging** (Story B). He may also add food diary entries without an episode (Story C).

---

## Story A — Starting an episode (template-first)

### One-time setup (in settings, when Eric is well)

1. Eric (or a caretaker) builds **symptom presets** and **health marker presets** as separate lists — the data model keeps those concerns separate.
2. Eric creates **episode templates** that **pair** one symptom preset with one health marker preset under a **single name** he will recognize when impaired:
   - e.g. **“ABS Episode”** → symptom list A + marker list A
   - e.g. **“CVS Episode”** → symptom list B + marker list B (vertigo / nausea / vomiting focus, without implying ABS-specific markers he does not need for that path)

Naming a symptom preset and a health marker preset the same string does **not** link them in the database; the **episode template** row is what ties them together.

### When Eric is having an episode

1. Eric taps **“I'm having an episode”** (large target, high contrast).
2. Eric chooses **one episode template** — e.g. **“ABS Episode”** or **“CVS Episode”** — **one choice**, not a wizard of separate preset pickers.
3. The app runs **all symptom prompts** for that template in order, then **all health marker prompts** in order, then the in-flow **food** step and **Episode details** (type, notes, and other fields per [PRD](../PRD.md)), then **Save and continue** to finish that **pass**.
4. If the episode is still **open** (`ended_at` not set) and Eric needs to log again — because symptoms, markers, or relevant food have **changed** — he uses **Resume / Continue this episode** and runs **another full pass** of the same order (symptoms → markers → food → Episode details → **Save and continue**). Each pass **adds** new time-stamped rows; it does not replace the previous pass with a single “current” value per line (see [Data model for repeat observations](#data-model-for-repeat-observations) above).

### Outcome

- Eric is not asked to assemble presets while impaired; he only picks **which kind of episode** this is, using labels he set up earlier.
- The **episode record** still persists **which** symptom preset and **which** health marker preset were used (via the template resolution — see roadmap: `health_marker_preset_id` on `episodes`).
- While the episode is open, Eric can run **multiple passes** through the **same** guided path from **Continue** until he **ends** the episode; the practitioner can see a **time-ordered** history of preset symptoms, markers, and **episode-tied** food.

---

## Story B — Asymptomatic, “just checking health markers”

### Setup

- Eric maintains **health marker presets** (e.g. “Daily vitals”, “Post-meal glucose”) independent of any episode.

### When Eric feels fine but wants numbers

1. Eric taps something like **“Log vitals”** / **“Health markers”** from home (**not** “I'm having an episode”).
2. Eric picks **one health marker preset** only.
3. The app walks **only** those markers in preset order and saves readings **without** symptom prompts and **without** an episode template (`health_markers.episode_id = null`).

### Outcome

- The same health marker preset can appear inside an episode template (Story A) and **alone** (Story B).
- Standalone health marker logging stays **first-class** — no requirement to link markers to symptoms for users who only need that path.

---

## Story C — Standalone food diary (non-episode path)

### When Eric wants to log food outside an episode

1. Eric opens a dedicated **Food diary** entry path from home or secondary navigation.
2. Eric records free-text food notes, meal tag, and timestamp without starting an episode.
3. **During** an open episode, **episode-tied** food (meals that belong to that flare for care-team review) is logged in the **guided** flow as part of a **pass** (see [Multiple guided passes](#multiple-guided-passes-while-the-episode-is-open)). The standalone path is for food **not** tied to a specific episode record (`episode_id` null).

### Outcome

- Food diary supports **two** clear lanes: **standalone** (home / manage; not bound to an episode) and **in the guided episode flow** (rows with `episode_id` set, time-ordered with other episode data for practitioners).
- Standalone food entries do not imply an episode; they are the right choice for “around the episode” or general logging without starting a flare record.

---

## Unified management concept (product-level)

The product includes one consolidated management surface (implemented accessibly on web + mobile) where users can review and delete entries across three groups:

- Episodes
- Standalone health marker entries (`health_markers.episode_id IS NULL`)
- Standalone food diary entries (entries not linked to an episode)

This story defines the scope boundary only; it does not prescribe exact layout, navigation hierarchy, or component-level UI patterns.

---

## Design principles (summary)

| Principle                              | Detail                                                                                                                                                |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Minimal choices when impaired**      | Episode start favors **one template choice** (or a very small list of named templates), not multiple preset pickers.                                  |
| **Independent preset lists in the DB** | Symptom presets and health marker presets remain separate editable lists; **templates** are how we pair them for logging without cognitive overload.  |
| **Explicit pairing**                   | The app must not guess; the **episode template** resolves which marker list goes with which symptom list.                                             |
| **Persist both IDs on the episode**    | For auditability, the episode row should store both `symptom_preset_id` and `health_marker_preset_id` once the schema supports it.                    |
| **Standalone health markers**          | Separate entry point; health marker preset only (`health_markers.episode_id = null`).                                                                 |
| **Standalone food diary**              | Separate non-episode entry path is allowed in addition to in-flow **episode-tied** food during a pass.                                                |
| **Multiple passes (open episode)**     | **Continue** only: after **Save and continue** on **Episode details**, another full pass of symptoms → markers → food; one row per observation, timestamp-ordered. |

---

## Implementation note

Database migrations, RLS, and typed client updates for `episodes.health_marker_preset_id` and for the **episode preset templates** (bundle) table are **not** specified in this user story file. Concrete tasks live as checkboxes under **[ROADMAP.md](../ROADMAP.md)** (episode template schema + picker in **Week 5**; full prompts, standalone health markers, standalone food diary, and unified management in **Week 6**; items for [multiple passes](#multiple-guided-passes-while-the-episode-is-open) and [repeat observations](#data-model-for-repeat-observations)).
