# User story: Episode logging vs standalone vitals (symptom + health marker presets)

**Status:** Draft (product intent; schedule on [ROADMAP.md](../ROADMAP.md) — **Week 5:** migrations (`health_marker_preset_id` + episode templates table), template settings UI, **I'm having an episode** + template picker; **Week 6:** full symptom + marker prompt flow, standalone vitals, food diary, wellness)  
**Related PRD:** [PRD.md](../PRD.md) — §3 Health Marker Presets, §4 Episode Logging, §5 General Wellness Logging

This document expands the **user-facing flows** for:

1. Starting an **episode** when the user may be **cognitively impaired** — the UI must not dump many choices on them at once ([PRD](../PRD.md) impaired-user requirements).
2. **Asymptomatic** use: the user only wants to **track vitals** using a health marker preset, with **no** symptom episode.

The PRD states the **order** of prompts (symptoms first, then health markers). This story adds **how** pairing is chosen without overwhelming the user at episode start.

---

## Accessibility intent: one clear choice, then a linear flow

Episode templates exist so that **configuration complexity** (symptom list + health marker list + how they pair) lives in **settings**, not at the moment someone taps **“I'm having an episode.”**

At episode start, the experience is: **pick what kind of episode this is** using **one** large, high-contrast choice per row (e.g. **“ABS Episode”**, **“CVS Episode”**) — each label is an **episode template** that already points at the right symptom preset **and** health marker preset. After that single decision, the app runs **one linear prompt flow** (symptoms in order, then markers in order). There is **no** separate “pick symptom preset” and “pick health marker preset” step during an episode; pairing is **only** done ahead of time when editing templates in settings.

---

## Persona — Eric

**Eric** lives with **ABS** and also has **an unknown vomiting condition**. He can feel the difference between:

- An **ABS-related** flare (where BAC and ABS-specific markers matter to his workflow), and  
- A **CVS-like** bout — vertigo, nausea, vomiting **without** it being an ABS episode for him.

So Eric needs **more than one named episode type** at start — not more complexity on one screen. He should see a **short list of big buttons** (or an equally accessible control), e.g. **“ABS Episode”** and **“CVS Episode”**, each backed by its own episode template (different symptom lines, different marker lines, or both). One tap → into the combined flow.

Eric also wants to log glucose or other markers on a **good day** without starting any episode — that is **standalone vitals** (Story B).

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
3. The app runs **all symptom prompts** for that template in order, then **all health marker prompts** in order, then extras / episode type / notes per [PRD](../PRD.md).

### Outcome

- Eric is not asked to assemble presets while impaired; he only picks **which kind of episode** this is, using labels he set up earlier.
- The **episode record** still persists **which** symptom preset and **which** health marker preset were used (via the template resolution — see roadmap: `health_marker_preset_id` on `episodes`).

---

## Story B — Asymptomatic, “just checking vitals”

### Setup

- Eric maintains **health marker presets** (e.g. “Daily vitals”, “Post-meal glucose”) independent of any episode.

### When Eric feels fine but wants numbers

1. Eric taps something like **“Log vitals”** / **“Health markers”** from home (**not** “I'm having an episode”).
2. Eric picks **one health marker preset** only.
3. The app walks **only** those markers in preset order and saves readings **without** symptom prompts and **without** an episode template.

### Outcome

- The same health marker preset can appear inside an episode template (Story A) and **alone** (Story B).
- Standalone vitals stay **first-class** — no requirement to link markers to symptoms for users who only need that path.

---

## Design principles (summary)

| Principle | Detail |
|-----------|--------|
| **Minimal choices when impaired** | Episode start favors **one template choice** (or a very small list of named templates), not multiple preset pickers. |
| **Independent preset lists in the DB** | Symptom presets and health marker presets remain separate editable lists; **templates** are how we pair them for logging without cognitive overload. |
| **Explicit pairing** | The app must not guess; the **episode template** resolves which marker list goes with which symptom list. |
| **Persist both IDs on the episode** | For auditability, the episode row should store both `symptom_preset_id` and `health_marker_preset_id` once the schema supports it. |
| **Standalone vitals** | Separate entry point; health marker preset only. |

---

## Implementation note

Database migrations, RLS, and typed client updates for `episodes.health_marker_preset_id` and for the **episode preset templates** (bundle) table are **not** specified in this user story file. Concrete tasks live as checkboxes under **[ROADMAP.md](../ROADMAP.md)** (episode template schema + picker in **Week 5**; full prompts and standalone vitals in **Week 6**).
