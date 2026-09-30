# Research notes — P1.M2.T1.S1 (plan 004): README sweep to landed tier-0 + loose-mode behavior

## Verified facts
- `plan/004_24ebf0115d16/architecture/tier0_design.md` §7 (docs riders) + §8 (drift/verification notes) — the authoritative stale-row list:
  - Four README rows to edit: :36–44 (three-tier feature bullet), :429 (fuzzThreshold config row), :194–195 (no-hijack prose), :128–131 (chaining blurb).
  - Verify-only (agree already ✅): module-layout rows (editor.ts/debug.ts/paths.ts), dict figures (48,802 entries / 850,554 B / LF 0.7445≈0.745 per shipped-dict.test.ts:13), M2 DoD re-theme (pinned acceptance.test.ts:838), decision log = spec/SPEC.md:67 section (no artifact). README:49 "(2026-10 decision log)" informal cite — fine.
  - Out of scope: widget rebind, rule-4d, M1/M2/M3 behavior, spec/*.md edits, tier-boundary retuning.
- README.md current state (588 lines) — read the four rows plus a full grep:
  - :36–44 feature bullet: says "three strictness tiers (exact prefix > contiguous tail > scattered)" + fuzzThreshold, no tier 0, no anchorless fallback, no `#` loose mode. Also :14 "anchored-fuzzy matching with tier/frequency ranking".
  - :45–52 tiered-order bullet: "match-strictness tier, then sessionCount…" — accurate but says nothing of tier 0; extend the order to 3>2>1>0 and add the fallback clause here too (same bullet family; count it in the sweep).
  - :128–131 chaining blurb (in the big chain paragraph): "Typed characters filter the live successor list normally (fuzzy matches admitted into chains, gated by the same fuzzThreshold)" — needs: chains stay ANCHORED; tier-0 matches never arm or extend a chain.
  - :194–195 no-hijack prose: "no result line appears for common words" — needs spec/09 item-2 amendment: "no menu for common words WITH ANCHORED MATCHES — the zero-result tier-0 fallback MAY surface one-shot contiguous-run cousin menus".
  - :429 config table fuzzThreshold row: no per-mode 60/45, no explicit-override-both semantics.
  - Other grep hits to audit (from `grep -n 'tier\|anchor' README.md`): :213–214 ("query (anchored-fuzzy matching + tier/frequency ranking)"), :230, :255, :454–457 ("tier constants… tier BOUNDARIES…"), :579 perf row ("20k-candidate anchored-fuzzy query (first-char bucket + tiers + frequency sort + top 8) | < 1 ms p99"). Audit each: :213/:230/:255 remain accurate but should mention the tier-0 fallback pass where they describe query flow (one clause each); :454–457 stays (boundaries semantics) — add tier 0's floor-3/score to the "not user-configurable" prose only if space allows (optional); :579 must ADD the tier-0 budget row (< 3 ms p99, fires only on the empty-anchored path) — the perf table is a "stale claims" target since it omits the new budget P1.M1.T1.S2 landed.
- Landed behavior inputs (task tree, all Complete or in-flight per P1.M1.T2.S2 PRP): tier-0 anchorless pass in rankMatches with RankedMatch.tier diagnostic (T1.S1), perf gate < 3 ms p99 (T1.S2), config explicit-vs-default resolution + per-mode 60/45 (T2.S1, in flight), provider/widget loose wiring + tier-0 never arms chains (T2.S2, in flight — PRP read: `RankOptions.loose`, `resolveFuzzThreshold(config, mode)`, applyCompletion skips chain.arm on tier===0, `#` alone → zero-fragment frequency listing).
- Spec source rows to mirror (quote-adjacent phrasing; spec is READ-ONLY):
  - spec/04 h2.28 tier-0 block: fires only when the anchored scan returns zero; ONE contiguous run anywhere (or at first position); floor 3 chars; score `85 − 40 · (runStart / len(c))`; threshold-gated; sorts below tier 1 → order 3>2>1>0.
  - spec/04 h2.28 `#` loosening: tier-0 ALWAYS consulted under `#` (no zero-result precondition; `#query` → `src/core/query.ts`); scattered tier-1 visible; `#` default threshold 45 (vs ambient 60); explicit `fuzzThreshold` overrides BOTH.
  - spec/04 h2.28 performance: anchored scan keeps < 1 ms; tier-0 pass its own < 3 ms p99 budget, fires only on the empty-anchored path.
  - spec/04 h2.28 measured-record clause amending spec/09 item 2: "no menu for common words WITH ANCHORED MATCHES; the zero-result fallback may surface contiguous-run cousins" (~5% 3-char → ~20% 7-char one-shot cousin menus, narrowing away; morphological cousins owner-accepted).
  - spec/07 h2.45 "Match gates per mode" paragraph — the per-mode summary sentence.
  - spec/08 h2.52 fuzzThreshold schema row (per-mode defaults + explicit override + auto-imported baked default).
  - spec/07 h2.49: "Successor chaining stays ANCHORED everywhere — tier-0 matches never arm or extend a chain."

## Style constraints
- README is NON-AUTHORITATIVE vs spec (AGENTS.md): mirror spec wording, never invent; keep each row's existing voice/format (feature bullets bold-lead; config table cells; prose paragraphs).
- No code, no tests, no spec edits. Validation = docs-only: re-grep for stale phrases; `npm run check`/`npm test` must remain green trivially (no code touched — run once to confirm).
