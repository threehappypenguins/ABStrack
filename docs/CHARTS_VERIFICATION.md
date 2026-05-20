# Charts feature verification (Week 9)

Manual smoke checklist for the interactive insights chart builder (user web + practitioner web). Automated coverage is noted where unit tests exercise the same behavior.

Run automated checks from the repo root:

```bash
pnpm validate
```

## Smoke tests

| #   | Scenario                                                                                                              | Status        | Automated coverage                                                                                                                            |
| --- | --------------------------------------------------------------------------------------------------------------------- | ------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Empty state:** New user with no episodes → Insights shows empty message, no chart                                   | Pass (manual) | `InsightsClient.spec.tsx` — empty manifest, text-only manifest                                                                                |
| 2   | **Manifest population:** Boolean + severity symptoms and standalone numeric markers appear; text/photo/video excluded | Pass (manual) | `InsightsClient.spec.tsx` — chartable manifest rows; `InsightSeriesPicker.spec.tsx`; `get_user_chart_manifest` maps photo/video to `text`     |
| 3   | **Single series — line:** Numeric marker, line chart → `ComposedChart`, accessible table, `figcaption` summary        | Pass (manual) | `InsightComposedChart.spec.tsx` — line chart, table, figcaption                                                                               |
| 4   | **Multi-series:** Severity as series 2 on same chart; series 2 chart types limited to line and bar                    | Pass (manual) | `InsightSeriesPicker.spec.tsx` — severity chart types; `InsightComposedChart.spec.tsx` — multiple lines                                       |
| 5   | **Boolean series:** Boolean as series 3 → `ReferenceLine` markers; no fourth slot                                     | Pass (manual) | `InsightComposedChart.spec.tsx` — ReferenceLine; `InsightSeriesPicker.spec.tsx` — max 3 slots                                                 |
| 6   | **Date range:** Preset (e.g. Last 7 days) refetches chart                                                             | Pass (manual) | `InsightsClient.spec.tsx` — date range change; `InsightDateRangePicker.spec.tsx` — presets                                                    |
| 7   | **Practitioner insights:** Patient detail Insights uses patient id for RPCs                                           | Pass (manual) | `patient-detail-insights.spec.tsx`                                                                                                            |
| 8   | **Chart sharing:** Practitioner shares with note → patient banner → view → `seen_by_patient_at` set                   | Pass (manual) | `InsightsClient.spec.tsx` — banner + `markChartSnapshotSeen`; `chart-snapshots-query.spec.ts`; `patient-detail-insights.spec.tsx` — share RPC |
| 9   | **Regression:** Dashboard, manage (episodes), health marker presets still reachable after Insights nav                | Pass (manual) | `AuthenticatedShell.spec.tsx`; `proxy.spec.ts` — `/insights` auth gate                                                                        |

## Manual-only follow-ups

- Screen reader pass on Insights filters and chart summary ([docs/A11Y.md](A11Y.md)).
- Confirm `seen_by_patient_at` in Supabase dashboard after smoke test #8 (automated tests mock the RPC).
- Full cross-app integration (caretaker logging, offline sync, media queue) remains covered by earlier weeks; re-run if you change shared auth or nav.

## Out of scope for this verification

Fixed dashboards from PRD §9 (episode frequency, symptom-frequency summary, episode-type breakdown, food-diary correlation) are tracked in the roadmap under [Post-MVP — Additional charts](ROADMAP.md#post-mvp--additional-charts-prd-9), not in Week 9.
